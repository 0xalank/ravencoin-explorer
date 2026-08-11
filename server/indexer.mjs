import 'dotenv/config'
import { getPool, migrate, closePool } from './db.mjs'
import { RavenRpc } from './rpc.mjs'
import { atomicToDecimal, BalanceAccumulator, decimalToAtomic, normalizeOutput } from './indexer-utils.mjs'
import { aggregateBlockRange, stageRawBlockBatch } from './pipeline.mjs'

const STATE_ID = 'ravencoin-mainnet'
const INDEXER_LOCK = 1_884_202_019
const BATCH_SIZE = Math.min(2_000, Math.max(1, Number(process.env.INDEXER_BATCH_SIZE) || 20))
const FETCH_CONCURRENCY = Math.min(16, Math.max(1, Number(process.env.INDEXER_FETCH_CONCURRENCY) || 1))
const RAW_LEAD_BLOCKS = Math.max(BATCH_SIZE, Number(process.env.INDEXER_RAW_LEAD_BLOCKS) || BATCH_SIZE * 4)
const POLL_MS = Math.max(1_000, Number(process.env.INDEXER_POLL_MS) || 5_000)
const ASSET_PAGE_SIZE = Math.min(5_000, Math.max(100, Number(process.env.INDEXER_ASSET_PAGE_SIZE) || 1_000))
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const asJson = (rows) => JSON.stringify(rows)
const outputKey = (txid, vout) => `${txid}:${vout}`

async function insertJson(client, rows, sql) {
  if (rows.length) await client.query(sql, [asJson(rows)])
}

async function getState(client) {
  const { rows } = await client.query('SELECT * FROM sync_state WHERE id = $1', [STATE_ID])
  return rows[0]
}

async function setState(client, fields) {
  const names = Object.keys(fields)
  const values = Object.values(fields)
  const assignments = names.map((name, index) => `${name} = $${index + 2}`).join(', ')
  await client.query(`UPDATE sync_state SET ${assignments}, updated_at = now() WHERE id = $1`, [STATE_ID, ...values])
}

async function fetchBlockBatch(rpc, firstHeight, lastHeight) {
  const heights = Array.from({ length: lastHeight - firstHeight + 1 }, (_, index) => firstHeight + index)
  const hashes = await rpc.batch(heights.map((height) => ({ method: 'getblockhash', params: [height] })))
  const calls = hashes.map((hash) => ({ method: 'getblock', params: [hash, 2] }))
  if (FETCH_CONCURRENCY === 1 || calls.length === 1) return rpc.batch(calls)
  const chunkSize = Math.ceil(calls.length / FETCH_CONCURRENCY)
  const chunks = []
  for (let offset = 0; offset < calls.length; offset += chunkSize) chunks.push(calls.slice(offset, offset + chunkSize))
  return (await Promise.all(chunks.map((chunk) => rpc.batch(chunk)))).flat()
}

function collectBlockRows(blocks) {
  return blocks.map((block) => ({
    height: block.height,
    hash: block.hash,
    previous_hash: block.previousblockhash ?? null,
    time: new Date(block.time * 1_000).toISOString(),
    size: block.size ?? 0,
    weight: block.weight ?? null,
    tx_count: block.nTx ?? block.tx?.length ?? 0,
    confirmations: block.confirmations ?? 0,
    difficulty: block.difficulty == null ? null : String(block.difficulty),
    version: block.version ?? null,
    merkle_root: block.merkleroot ?? null,
    nonce: block.nonce == null ? null : String(block.nonce),
    bits: block.bits ?? null,
    chainwork: block.chainwork ?? null,
  }))
}

export async function indexBlockBatch(pool, blocks, expectedPreviousHash) {
  if (!blocks.length) return new Set()
  for (let index = 0; index < blocks.length; index += 1) {
    const expected = index === 0 ? expectedPreviousHash : blocks[index - 1].hash
    if (blocks[index].height > 0 && blocks[index].previousblockhash !== expected) {
      throw new Error(`Chain discontinuity at height ${blocks[index].height}`)
    }
  }

  const client = await pool.connect()
  const assetNames = new Set()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL synchronous_commit = off')
    await insertJson(client, collectBlockRows(blocks), `
      INSERT INTO blocks (height, hash, previous_hash, time, size, weight, tx_count, confirmations, difficulty, version, merkle_root, nonce, bits, chainwork)
      SELECT height, hash, previous_hash, time, size, weight, tx_count, confirmations, difficulty, version, merkle_root, nonce, bits, chainwork
      FROM jsonb_to_recordset($1::jsonb) AS x(
        height bigint, hash char(64), previous_hash char(64), time timestamptz, size integer, weight integer,
        tx_count integer, confirmations integer, difficulty numeric, version bigint, merkle_root char(64), nonce numeric,
        bits varchar(16), chainwork text
      ) ON CONFLICT (height) DO NOTHING
    `)

    const transactionRows = []
    const outputRows = []
    const outputAddressRows = []
    const normalizedByTransaction = new Map()
    const blockByTransaction = new Map()
    const transactionById = new Map()

    for (const block of blocks) {
      for (const [txIndex, transaction] of (block.tx ?? []).entries()) {
        const outputs = (transaction.vout ?? []).map(normalizeOutput)
        const totalOutput = outputs.reduce((total, output) => total + decimalToAtomic(output.value), 0n)
        transactionById.set(transaction.txid, transaction)
        normalizedByTransaction.set(transaction.txid, outputs)
        blockByTransaction.set(transaction.txid, { block, txIndex })
        transactionRows.push({
          txid: transaction.txid,
          block_height: block.height,
          block_hash: block.hash,
          tx_index: txIndex,
          time: new Date(block.time * 1_000).toISOString(),
          size: transaction.size ?? null,
          vsize: transaction.vsize ?? transaction.size ?? null,
          weight: transaction.weight ?? null,
          version: transaction.version ?? null,
          locktime: transaction.locktime ?? null,
          total_output_rvn: atomicToDecimal(totalOutput),
        })
        for (const output of outputs) {
          if (output.asset) assetNames.add(output.asset.name)
          outputRows.push({
            txid: transaction.txid,
            vout_index: output.index,
            value_rvn: output.value,
            script_type: output.scriptType,
            script_hex: output.scriptHex,
            asset_name: output.asset?.name ?? null,
            asset_amount: output.asset?.amount ?? null,
            asset_type: output.asset?.type ?? null,
          })
          for (const address of output.addresses) outputAddressRows.push({ txid: transaction.txid, vout_index: output.index, address })
        }
      }
    }

    await insertJson(client, transactionRows, `
      INSERT INTO transactions (txid, block_height, block_hash, tx_index, time, size, vsize, weight, version, locktime, total_output_rvn)
      SELECT txid, block_height, block_hash, tx_index, time, size, vsize, weight, version, locktime, total_output_rvn
      FROM jsonb_to_recordset($1::jsonb) AS x(
        txid char(64), block_height bigint, block_hash char(64), tx_index integer, time timestamptz,
        size integer, vsize integer, weight integer, version integer, locktime bigint, total_output_rvn numeric
      ) ON CONFLICT (txid) DO NOTHING
    `)
    await insertJson(client, outputRows, `
      INSERT INTO tx_outputs (txid, vout_index, value_rvn, script_type, script_hex, asset_name, asset_amount, asset_type)
      SELECT txid, vout_index, value_rvn, script_type, script_hex, asset_name, asset_amount, asset_type
      FROM jsonb_to_recordset($1::jsonb) AS x(
        txid char(64), vout_index integer, value_rvn numeric, script_type text, script_hex text,
        asset_name text, asset_amount numeric, asset_type text
      ) ON CONFLICT (txid, vout_index) DO NOTHING
    `)
    await insertJson(client, outputAddressRows, `
      INSERT INTO output_addresses (txid, vout_index, address)
      SELECT txid, vout_index, address
      FROM jsonb_to_recordset($1::jsonb) AS x(txid char(64), vout_index integer, address text)
      ON CONFLICT DO NOTHING
    `)

    const previousReferences = [...new Map(blocks.flatMap((block) => (block.tx ?? []).flatMap((transaction) =>
      (transaction.vin ?? []).filter((input) => input.txid != null).map((input) => [outputKey(input.txid, input.vout), { txid: input.txid, vout_index: input.vout }])
    ))).values()]
    const previousOutputs = new Map()
    if (previousReferences.length) {
      const { rows } = await client.query(`
        WITH requested AS MATERIALIZED (
          SELECT txid, vout_index FROM jsonb_to_recordset($1::jsonb) AS x(txid char(64), vout_index integer)
        )
        SELECT o.txid, o.vout_index, o.value_rvn, o.asset_name, o.asset_amount,
          COALESCE(array_agg(a.address) FILTER (WHERE a.address IS NOT NULL), '{}') AS addresses
        FROM requested r JOIN tx_outputs o ON o.txid = r.txid AND o.vout_index = r.vout_index
        LEFT JOIN output_addresses a ON a.txid = o.txid AND a.vout_index = o.vout_index
        GROUP BY o.txid, o.vout_index, o.value_rvn, o.asset_name, o.asset_amount
      `, [asJson(previousReferences)])
      for (const row of rows) previousOutputs.set(outputKey(row.txid.trim(), row.vout_index), row)
    }

    const inputRows = []
    const spendRows = []
    const activityRows = []
    const addressTransactionRows = []
    const addressTransactions = new Set()
    const balanceChanges = new BalanceAccumulator()
    const transactionTotals = []
    const inputAssets = new Map()

    const addAddressTransaction = (address, txid, blockHeight, txIndex) => {
      const key = `${address}\u0000${txid}`
      if (addressTransactions.has(key)) return
      addressTransactions.add(key)
      addressTransactionRows.push({ address, txid, block_height: blockHeight, tx_index: txIndex })
    }
    const addActivity = (address, txid, blockHeight, txIndex, ioIndex, direction, assetName, amount) => {
      if (!address || decimalToAtomic(amount) === 0n) return
      activityRows.push({ address, txid, block_height: blockHeight, tx_index: txIndex, io_index: ioIndex, direction, asset_name: assetName, amount })
      addAddressTransaction(address, txid, blockHeight, txIndex)
      balanceChanges.add(address, assetName, amount, direction, blockHeight)
    }

    for (const [txid, outputs] of normalizedByTransaction) {
      const { block, txIndex } = blockByTransaction.get(txid)
      for (const output of outputs) {
        for (const address of output.addresses) {
          addActivity(address, txid, block.height, txIndex, output.index, 'receive', 'RVN', output.value)
          if (output.asset) addActivity(address, txid, block.height, txIndex, output.index, 'receive', output.asset.name, output.asset.amount)
        }
      }
    }

    for (const [txid, transaction] of transactionById) {
      const { block, txIndex } = blockByTransaction.get(txid)
      let totalInput = 0n
      let inputsComplete = true
      let coinbase = false
      const assetsForTransaction = new Map()
      for (const [vinIndex, input] of (transaction.vin ?? []).entries()) {
        if (input.coinbase) {
          coinbase = true
          inputRows.push({ txid, vin_index: vinIndex, prev_txid: null, prev_vout: null, coinbase: input.coinbase, sequence: input.sequence ?? null, addresses: [], value_rvn: null, asset_name: null, asset_amount: null })
          continue
        }
        const previous = previousOutputs.get(outputKey(input.txid, input.vout))
        if (!previous) inputsComplete = false
        const addresses = previous?.addresses ?? []
        const value = previous?.value_rvn ?? null
        const assetName = previous?.asset_name ?? null
        const assetAmount = previous?.asset_amount ?? null
        if (value != null) totalInput += decimalToAtomic(value)
        inputRows.push({ txid, vin_index: vinIndex, prev_txid: input.txid, prev_vout: input.vout, coinbase: null, sequence: input.sequence ?? null, addresses, value_rvn: value, asset_name: assetName, asset_amount: assetAmount })
        spendRows.push({ prev_txid: input.txid, prev_vout: input.vout, spent_by_txid: txid, spent_by_vin: vinIndex })
        for (const address of addresses) {
          if (value != null) addActivity(address, txid, block.height, txIndex, vinIndex, 'send', 'RVN', value)
          if (assetName && assetAmount != null) addActivity(address, txid, block.height, txIndex, vinIndex, 'send', assetName, assetAmount)
        }
        if (assetName) {
          const from = assetsForTransaction.get(assetName) ?? new Set()
          addresses.forEach((address) => from.add(address))
          assetsForTransaction.set(assetName, from)
        }
      }
      inputAssets.set(txid, assetsForTransaction)
      const totalOutput = normalizedByTransaction.get(txid).reduce((total, output) => total + decimalToAtomic(output.value), 0n)
      transactionTotals.push({
        txid,
        total_input_rvn: coinbase || !inputsComplete ? null : atomicToDecimal(totalInput),
        fee_rvn: coinbase || !inputsComplete ? null : atomicToDecimal(totalInput - totalOutput),
      })
    }

    await insertJson(client, inputRows, `
      INSERT INTO tx_inputs (txid, vin_index, prev_txid, prev_vout, coinbase, sequence, addresses, value_rvn, asset_name, asset_amount)
      SELECT txid, vin_index, prev_txid, prev_vout, coinbase, sequence, addresses, value_rvn, asset_name, asset_amount
      FROM jsonb_to_recordset($1::jsonb) AS x(
        txid char(64), vin_index integer, prev_txid char(64), prev_vout integer, coinbase text,
        sequence numeric, addresses text[], value_rvn numeric, asset_name text, asset_amount numeric
      ) ON CONFLICT (txid, vin_index) DO NOTHING
    `)
    await insertJson(client, spendRows, `
      UPDATE tx_outputs o SET spent_by_txid = x.spent_by_txid, spent_by_vin = x.spent_by_vin
      FROM jsonb_to_recordset($1::jsonb) AS x(prev_txid char(64), prev_vout integer, spent_by_txid char(64), spent_by_vin integer)
      WHERE o.txid = x.prev_txid AND o.vout_index = x.prev_vout
    `)
    await insertJson(client, transactionTotals, `
      UPDATE transactions t SET total_input_rvn = x.total_input_rvn, fee_rvn = x.fee_rvn
      FROM jsonb_to_recordset($1::jsonb) AS x(txid char(64), total_input_rvn numeric, fee_rvn numeric)
      WHERE t.txid = x.txid
    `)
    await insertJson(client, activityRows, `
      INSERT INTO address_activity (address, txid, block_height, tx_index, io_index, direction, asset_name, amount)
      SELECT address, txid, block_height, tx_index, io_index, direction, asset_name, amount
      FROM jsonb_to_recordset($1::jsonb) AS x(
        address text, txid char(64), block_height bigint, tx_index integer, io_index integer,
        direction text, asset_name text, amount numeric
      ) ON CONFLICT DO NOTHING
    `)
    await insertJson(client, addressTransactionRows, `
      INSERT INTO address_transactions (address, txid, block_height, tx_index)
      SELECT address, txid, block_height, tx_index
      FROM jsonb_to_recordset($1::jsonb) AS x(address text, txid char(64), block_height bigint, tx_index integer)
      ON CONFLICT DO NOTHING
    `)
    await insertJson(client, balanceChanges.rows(), `
      INSERT INTO address_balances (address, asset_name, balance, received, sent, updated_height)
      SELECT address, asset_name, balance, received, sent, updated_height
      FROM jsonb_to_recordset($1::jsonb) AS x(
        address text, asset_name text, balance numeric, received numeric, sent numeric, updated_height bigint
      ) ON CONFLICT (address, asset_name) DO UPDATE SET
        balance = address_balances.balance + EXCLUDED.balance,
        received = address_balances.received + EXCLUDED.received,
        sent = address_balances.sent + EXCLUDED.sent,
        updated_height = GREATEST(address_balances.updated_height, EXCLUDED.updated_height)
    `)

    const transferRows = []
    for (const [txid, outputs] of normalizedByTransaction) {
      const { block, txIndex } = blockByTransaction.get(txid)
      for (const output of outputs.filter((item) => item.asset)) {
        transferRows.push({
          asset_name: output.asset.name,
          txid,
          block_height: block.height,
          tx_index: txIndex,
          vout_index: output.index,
          transfer_type: output.asset.type,
          amount: output.asset.amount,
          from_addresses: [...(inputAssets.get(txid)?.get(output.asset.name) ?? [])],
          to_addresses: output.addresses,
        })
      }
    }
    await insertJson(client, transferRows, `
      INSERT INTO asset_transfers (asset_name, txid, block_height, tx_index, vout_index, transfer_type, amount, from_addresses, to_addresses)
      SELECT asset_name, txid, block_height, tx_index, vout_index, transfer_type, amount, from_addresses, to_addresses
      FROM jsonb_to_recordset($1::jsonb) AS x(
        asset_name text, txid char(64), block_height bigint, tx_index integer, vout_index integer,
        transfer_type text, amount numeric, from_addresses text[], to_addresses text[]
      ) ON CONFLICT DO NOTHING
    `)
    if (assetNames.size) await client.query(`
      INSERT INTO asset_sync_queue (asset_name, seen_height)
      SELECT unnest($1::text[]), $2::bigint
      ON CONFLICT (asset_name) DO UPDATE SET seen_height = GREATEST(asset_sync_queue.seen_height, EXCLUDED.seen_height), updated_at = now()
    `, [[...assetNames], blocks.at(-1).height])

    const tip = blocks.at(-1)
    await setState(client, { best_height: tip.height, best_hash: tip.hash, status: 'syncing', indexed_at: new Date(), last_error: null })
    await client.query('COMMIT')
    return assetNames
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function upsertAssets(pool, assets, seenHeight = null) {
  const rows = Object.entries(assets ?? {}).map(([name, asset]) => ({
    name,
    amount: atomicToDecimal(decimalToAtomic(asset.amount ?? 0)),
    units: Number(asset.units ?? 0),
    reissuable: Boolean(asset.reissuable),
    has_ipfs: Boolean(asset.has_ipfs),
    ipfs_hash: asset.ipfs_hash ?? null,
    txid_hash: asset.txid_hash ?? null,
    created_height: asset.block_height ?? null,
    created_hash: asset.blockhash ?? null,
    last_seen_height: seenHeight,
  }))
  await insertJson(pool, rows, `
    INSERT INTO assets (name, amount, units, reissuable, has_ipfs, ipfs_hash, txid_hash, created_height, created_hash, last_seen_height)
    SELECT name, amount, units, reissuable, has_ipfs, ipfs_hash, txid_hash, created_height, created_hash, last_seen_height
    FROM jsonb_to_recordset($1::jsonb) AS x(
      name text, amount numeric, units smallint, reissuable boolean, has_ipfs boolean, ipfs_hash text,
      txid_hash text, created_height bigint, created_hash char(64), last_seen_height bigint
    ) ON CONFLICT (name) DO UPDATE SET
      amount = EXCLUDED.amount, units = EXCLUDED.units, reissuable = EXCLUDED.reissuable,
      has_ipfs = EXCLUDED.has_ipfs, ipfs_hash = EXCLUDED.ipfs_hash, txid_hash = EXCLUDED.txid_hash,
      created_height = COALESCE(assets.created_height, EXCLUDED.created_height),
      created_hash = COALESCE(assets.created_hash, EXCLUDED.created_hash),
      last_seen_height = COALESCE(EXCLUDED.last_seen_height, assets.last_seen_height), updated_at = now()
  `)
}

async function refreshAssets(pool, rpc, names, height) {
  const list = [...names]
  for (let offset = 0; offset < list.length; offset += 50) {
    const page = list.slice(offset, offset + 50)
    const results = await rpc.batch(page.map((name) => ({ method: 'listassets', params: [name, true, 1, 0] })))
    for (const result of results) await upsertAssets(pool, result, height)
    await pool.query('DELETE FROM asset_sync_queue WHERE asset_name = ANY($1::text[])', [page])
  }
}

async function drainAssetQueue(pool, rpc, height) {
  const { rows } = await pool.query('SELECT asset_name FROM asset_sync_queue ORDER BY seen_height, queued_at LIMIT 100')
  if (!rows.length) return false
  const names = rows.map((row) => row.asset_name)
  try { await refreshAssets(pool, rpc, names, height) }
  catch (error) {
    await pool.query(`UPDATE asset_sync_queue SET attempts = attempts + 1, last_error = $2, updated_at = now() WHERE asset_name = ANY($1::text[])`, [names, String(error.message ?? error).slice(0, 1_000)])
    throw error
  }
  return true
}

async function bootstrapAssets(pool, rpc) {
  if (String(process.env.INDEXER_BOOTSTRAP_ASSETS ?? 'true').toLowerCase() === 'false') return
  const { rows: countRows } = await pool.query('SELECT count(*) AS count FROM assets')
  if (Number(countRows[0]?.count) > 0) return
  let offset = 0
  while (true) {
    const page = await rpc.call('listassets', ['*', true, ASSET_PAGE_SIZE, offset])
    const count = Object.keys(page ?? {}).length
    if (!count) break
    await upsertAssets(pool, page)
    offset += count
    console.log(`Asset directory: ${offset.toLocaleString()} assets loaded`)
    if (count < ASSET_PAGE_SIZE) break
  }
}

async function findCommonAncestor(client, rpc, startingHeight) {
  let height = startingHeight
  while (height >= 0) {
    const { rows } = await client.query('SELECT hash FROM blocks WHERE height = $1', [height])
    if (!rows[0]) { height -= 1; continue }
    try {
      const canonicalHash = await rpc.call('getblockhash', [height])
      if (canonicalHash === rows[0].hash.trim()) return height
    } catch {}
    height -= 1
  }
  return -1
}

export async function rollbackTo(pool, rpc, ancestorHeight) {
  const client = await pool.connect()
  let affectedAssets = []
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL synchronous_commit = off')
    const state = await getState(client)
    const processedHeight = Math.min(Number(state.best_height), ancestorHeight)
    await setState(client, { status: 'reorg' })
    const addresses = (await client.query('SELECT DISTINCT address FROM address_activity WHERE block_height > $1', [ancestorHeight])).rows.map((row) => row.address)
    affectedAssets = (await client.query("SELECT DISTINCT asset_name FROM asset_transfers WHERE block_height > $1 AND transfer_type IN ('issue', 'reissue')", [ancestorHeight])).rows.map((row) => row.asset_name)
    await client.query('DELETE FROM blocks WHERE height > $1', [ancestorHeight])
    if (affectedAssets.length) {
      await client.query('DELETE FROM assets WHERE name = ANY($1::text[])', [affectedAssets])
      await client.query(`
        INSERT INTO asset_sync_queue (asset_name, seen_height) SELECT unnest($1::text[]), $2::bigint
        ON CONFLICT (asset_name) DO UPDATE SET seen_height = EXCLUDED.seen_height, updated_at = now()
      `, [affectedAssets, ancestorHeight])
    }
    if (addresses.length) {
      await client.query('DELETE FROM address_balances WHERE address = ANY($1::text[])', [addresses])
      await client.query(`
        INSERT INTO address_balances (address, asset_name, balance, received, sent, updated_height)
        SELECT address, asset_name,
          sum(CASE WHEN direction = 'receive' THEN amount ELSE -amount END),
          sum(CASE WHEN direction = 'receive' THEN amount ELSE 0 END),
          sum(CASE WHEN direction = 'send' THEN amount ELSE 0 END), max(block_height)
        FROM address_activity WHERE address = ANY($1::text[]) GROUP BY address, asset_name
      `, [addresses])
    }
    const processedTip = processedHeight >= 0 ? (await client.query('SELECT hash FROM blocks WHERE height = $1', [processedHeight])).rows[0] : null
    const rawTip = ancestorHeight >= 0 ? (await client.query('SELECT hash FROM blocks WHERE height = $1', [ancestorHeight])).rows[0] : null
    await setState(client, {
      best_height: processedHeight, best_hash: processedTip?.hash?.trim() ?? null,
      raw_height: ancestorHeight, raw_hash: rawTip?.hash?.trim() ?? null,
      status: 'syncing', last_error: null,
    })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
  if (affectedAssets.length) await refreshAssets(pool, rpc, affectedAssets, ancestorHeight).catch((error) => console.warn('Asset refresh after reorg failed:', error.message))
}

export class RavencoinIndexer {
  constructor({ pool = getPool(), rpc = new RavenRpc() } = {}) {
    this.pool = pool
    this.rpc = rpc
    this.stopping = false
  }

  stop() { this.stopping = true }

  async syncOnce() {
    const chain = await this.rpc.call('getblockchaininfo')
    if (chain.chain !== 'main' && String(process.env.ALLOW_NON_MAINNET).toLowerCase() !== 'true') throw new Error(`Refusing to index unexpected chain: ${chain.chain}`)
    let state = await getState(this.pool)
    const rawHeight = Number(state.raw_height ?? state.best_height)
    const rawHash = state.raw_hash?.trim() ?? state.best_hash?.trim()
    if (rawHeight >= 0) {
      let canonical
      try { canonical = await this.rpc.call('getblockhash', [rawHeight]) } catch {}
      if (!canonical || canonical !== rawHash) {
        const ancestor = await findCommonAncestor(this.pool, this.rpc, Math.min(rawHeight, chain.blocks))
        console.warn(`Reorg detected. Rolling back to height ${ancestor}.`)
        await rollbackTo(this.pool, this.rpc, ancestor)
        state = await getState(this.pool)
      }
    }
    await setState(this.pool, {
      status: 'syncing', target_height: chain.blocks, started_at: state.started_at ?? new Date(), last_error: null,
      raw_height: state.raw_height == null || Number(state.raw_height) < Number(state.best_height) ? state.best_height : state.raw_height,
      raw_hash: state.raw_hash == null || Number(state.raw_height) < Number(state.best_height) ? state.best_hash : state.raw_hash,
    })

    let pipelineDone = false
    const produce = async () => {
      while (!this.stopping) {
        const current = await getState(this.pool)
        const stagedHeight = Number(current.raw_height)
        const processedHeight = Number(current.best_height)
        if (stagedHeight >= chain.blocks) return
        if (stagedHeight - processedHeight >= RAW_LEAD_BLOCKS) { await sleep(100); continue }
        const first = stagedHeight + 1
        const last = Math.min(chain.blocks, first + BATCH_SIZE - 1, processedHeight + RAW_LEAD_BLOCKS)
        const blocks = await fetchBlockBatch(this.rpc, first, last)
        await stageRawBlockBatch(this.pool, blocks, current.raw_hash?.trim() ?? current.best_hash?.trim() ?? null)
        if (last % 5_000 < BATCH_SIZE) console.log(`Raw block data ${last.toLocaleString()} / ${chain.blocks.toLocaleString()}`)
      }
    }
    const aggregate = async () => {
      while (!this.stopping) {
        const current = await getState(this.pool)
        const processedHeight = Number(current.best_height)
        if (processedHeight >= chain.blocks) return
        const stagedHeight = Number(current.raw_height)
        if (stagedHeight <= processedHeight) { await sleep(100); continue }
        const first = processedHeight + 1
        const last = Math.min(stagedHeight, first + BATCH_SIZE - 1, chain.blocks)
        await aggregateBlockRange(this.pool, first, last)
        if (last % 1_000 < BATCH_SIZE) console.log(`Indexed block ${last.toLocaleString()} / ${chain.blocks.toLocaleString()}`)
      }
    }
    const assets = async () => {
      while (!this.stopping && !pipelineDone) {
        try {
          const current = await getState(this.pool)
          const worked = await drainAssetQueue(this.pool, this.rpc, current.best_height)
          if (!worked) await sleep(500)
        } catch (error) {
          console.warn('Deferred asset metadata refresh:', error.message)
          await sleep(1_000)
        }
      }
      while (!this.stopping && await drainAssetQueue(this.pool, this.rpc, chain.blocks).catch(() => false)) {}
    }
    const pipeline = Promise.all([produce(), aggregate()]).finally(() => { pipelineDone = true })
    await Promise.all([pipeline, assets()])
    if (!this.stopping) await setState(this.pool, { status: 'ready', target_height: chain.blocks, indexed_at: new Date(), last_error: null })
  }

  async run() {
    while (!this.stopping) {
      try { await this.syncOnce() }
      catch (error) {
        console.error('Indexer cycle failed:', error)
        await setState(this.pool, { status: 'error', last_error: String(error.message ?? error).slice(0, 2_000) }).catch(() => {})
      }
      if (!this.stopping) await sleep(POLL_MS)
    }
  }
}

async function main() {
  await migrate()
  const pool = getPool()
  const lockClient = await pool.connect()
  const { rows } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [INDEXER_LOCK])
  if (!rows[0].locked) throw new Error('Another Ravencoin indexer already holds the database lock.')
  const indexer = new RavencoinIndexer({ pool })
  const stop = () => indexer.stop()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    await bootstrapAssets(pool, indexer.rpc).catch((error) => console.warn('Asset directory bootstrap deferred:', error.message))
    await indexer.run()
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [INDEXER_LOCK]).catch(() => {})
    lockClient.release()
    await closePool()
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => { console.error('Indexer failed to start:', error); process.exitCode = 1 })
}
