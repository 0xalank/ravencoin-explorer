import 'dotenv/config'
import { closePool, getPool } from '../../server/db.mjs'
import { decimalToAtomic, normalizeOutput } from '../../server/indexer-utils.mjs'

const STATE_ID = 'ravencoin-mainnet'
const ASSET_ACTIVATION_HEIGHT = 435_456

function integerSetting(name, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const value = process.env[name] == null ? fallback : Number(process.env[name])
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

function booleanSetting(name, fallback) {
  if (process.env[name] == null) return fallback
  if (/^(1|true|yes)$/i.test(process.env[name])) return true
  if (/^(0|false|no)$/i.test(process.env[name])) return false
  throw new Error(`${name} must be true or false.`)
}

function parseExactJson(text) {
  // Asset amounts and atomic RPC fields can exceed JavaScript's safe integer
  // range. Preserve monetary source text and compare it as bigint atoms.
  return JSON.parse(text.replace(
    /("(?:satoshis|balance|received|amount|value)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    '$1"$2"',
  ))
}

class ExactRavenRpc {
  constructor() {
    this.url = process.env.RAVEN_RPC_URL ?? 'http://127.0.0.1:8766'
    this.user = process.env.RAVEN_RPC_USER ?? ''
    this.password = process.env.RAVEN_RPC_PASSWORD ?? ''
    this.timeout = integerSetting('RECONCILE_RPC_TIMEOUT_MS', 120_000, 1_000, 900_000)
  }

  async batch(calls) {
    if (!calls.length) return []
    const requests = calls.map((call, index) => ({
      jsonrpc: '1.0', id: `reconcile-${index}`, method: call.method, params: call.params ?? [],
    }))
    let response
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${this.user}:${this.password}`).toString('base64')}`,
        },
        body: JSON.stringify(requests.length === 1 ? requests[0] : requests),
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch (error) {
      throw new Error(`Ravencoin RPC is unavailable: ${error.message}`)
    }
    if (!response.ok) throw new Error(`Ravencoin RPC returned HTTP ${response.status}.`)
    const payload = parseExactJson(await response.text())
    const responses = Array.isArray(payload) ? payload : [payload]
    const byId = new Map(responses.map((item) => [item.id, item]))
    return requests.map((request) => {
      const item = byId.get(request.id)
      if (!item) throw new Error(`RPC omitted response ${request.id}.`)
      if (item.error) throw new Error(`${request.method}: ${item.error.message ?? 'RPC error'} (${item.error.code ?? 'unknown'})`)
      return item.result
    })
  }
}

function chunks(items, size) {
  const result = []
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size))
  return result
}

async function rpcInChunks(rpc, calls, size) {
  const results = []
  for (const batch of chunks(calls, size)) results.push(...await rpc.batch(batch))
  return results
}

function trimHash(value) {
  return value == null ? null : String(value).trim()
}

function sortedUnique(values) {
  return [...new Set((values ?? []).filter(Boolean))].sort()
}

function sameArray(left, right) {
  const a = sortedUnique(left)
  const b = sortedUnique(right)
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function outputKey(txid, index) {
  return `${txid}:${index}`
}

function transferKey(event) {
  return `${event.txid}\u0000${event.voutIndex}\u0000${event.assetName}`
}

async function loadTransferSamples(pool, height, limit) {
  if (!limit) return []
  const { rows } = await pool.query(`
    SELECT a.id, a.asset_name, trim(a.txid) AS txid, a.block_height, a.vout_index,
      a.transfer_type, a.amount, a.to_addresses, trim(t.block_hash) AS block_hash
    FROM asset_transfers a JOIN transactions t USING (txid)
    WHERE a.block_height <= $1
    ORDER BY a.id DESC LIMIT $2
  `, [height, limit])
  return rows
}

function uniformlySpacedHeights(bestHeight, count) {
  if (!count) return []
  const span = bestHeight - ASSET_ACTIVATION_HEIGHT + 1
  return Array.from({ length: Math.min(count, span) }, (_, index) => (
    ASSET_ACTIVATION_HEIGHT + Math.floor(((index + 0.5) * span) / Math.min(count, span))
  ))
}

async function loadCanonicalBlocks(pool, rpc, bestHeight, transferSamples, blockSamples, rpcBatchSize) {
  const heights = new Set(transferSamples.map((sample) => Number(sample.block_height)))
  for (const height of uniformlySpacedHeights(bestHeight, blockSamples)) heights.add(height)
  heights.add(bestHeight)
  const orderedHeights = [...heights].sort((a, b) => a - b)
  const { rows } = await pool.query(
    'SELECT height, trim(hash) AS hash FROM blocks WHERE height = ANY($1::bigint[]) AND height <= $2 ORDER BY height',
    [orderedHeights, bestHeight],
  )
  if (rows.length !== orderedHeights.length) throw new Error('One or more sampled PostgreSQL blocks are missing.')

  const canonicalHashes = await rpcInChunks(
    rpc,
    rows.map((row) => ({ method: 'getblockhash', params: [Number(row.height)] })),
    rpcBatchSize,
  )
  for (const [index, row] of rows.entries()) {
    if (trimHash(canonicalHashes[index]) !== trimHash(row.hash)) {
      throw new Error(`Canonical hash mismatch at block ${row.height}.`)
    }
  }
  const blocks = await rpcInChunks(
    rpc,
    canonicalHashes.map((hash) => ({ method: 'getblock', params: [hash, 2] })),
    rpcBatchSize,
  )
  for (const [index, block] of blocks.entries()) {
    if (Number(block.height) !== Number(rows[index].height) || trimHash(block.hash) !== trimHash(rows[index].hash)) {
      throw new Error(`Verbose block response mismatch at height ${rows[index].height}.`)
    }
  }
  return blocks
}

function collectRpcFacts(blocks) {
  const outputs = []
  const receiveEvents = []
  const transfers = []
  for (const block of blocks) {
    for (const [txIndex, transaction] of (block.tx ?? []).entries()) {
      for (const rawOutput of transaction.vout ?? []) {
        const output = normalizeOutput(rawOutput)
        const item = {
          txid: transaction.txid,
          blockHeight: Number(block.height),
          txIndex,
          voutIndex: output.index,
          value: output.value,
          scriptType: output.scriptType,
          addresses: output.addresses,
          asset: output.asset,
        }
        outputs.push(item)
        for (const address of output.addresses) {
          if (decimalToAtomic(output.value) !== 0n) receiveEvents.push({
            address, txid: item.txid, blockHeight: item.blockHeight, txIndex, ioIndex: output.index,
            assetName: 'RVN', amount: output.value,
          })
          if (output.asset && decimalToAtomic(output.asset.amount) !== 0n) receiveEvents.push({
            address, txid: item.txid, blockHeight: item.blockHeight, txIndex, ioIndex: output.index,
            assetName: output.asset.name, amount: output.asset.amount,
          })
        }
        if (output.asset) transfers.push({
          txid: item.txid, blockHeight: item.blockHeight, txIndex, voutIndex: output.index,
          assetName: output.asset.name, amount: output.asset.amount, transferType: output.asset.type,
          toAddresses: output.addresses,
        })
      }
    }
  }
  return { outputs, receiveEvents, transfers }
}

async function compareRawOutputs(pool, rpcOutputs) {
  const txids = [...new Set(rpcOutputs.map((output) => output.txid))]
  const { rows } = await pool.query(`
    SELECT trim(o.txid) AS txid, o.vout_index, o.value_rvn, o.script_type,
      o.asset_name, o.asset_amount, o.asset_type,
      COALESCE(array_agg(a.address ORDER BY a.address) FILTER (WHERE a.address IS NOT NULL), '{}') AS addresses
    FROM tx_outputs o LEFT JOIN output_addresses a USING (txid, vout_index)
    WHERE o.txid = ANY($1::char(64)[])
    GROUP BY o.txid, o.vout_index
  `, [txids])
  const indexed = new Map(rows.map((row) => [outputKey(row.txid, row.vout_index), row]))
  const mismatches = []
  for (const output of rpcOutputs) {
    const row = indexed.get(outputKey(output.txid, output.voutIndex))
    const differences = []
    if (!row) differences.push('missing-output')
    else {
      if (decimalToAtomic(row.value_rvn) !== decimalToAtomic(output.value)) differences.push('rvn-value')
      if (row.script_type !== output.scriptType) differences.push('script-type')
      if (!sameArray(row.addresses, output.addresses)) differences.push('addresses')
      if ((row.asset_name ?? null) !== (output.asset?.name ?? null)) differences.push('asset-name')
      if (row.asset_name && decimalToAtomic(row.asset_amount) !== decimalToAtomic(output.asset?.amount)) differences.push('asset-amount')
      if ((row.asset_type ?? null) !== (output.asset?.type ?? null)) differences.push('asset-type')
    }
    if (differences.length) mismatches.push({ kind: 'raw-output', txid: output.txid, vout: output.voutIndex, differences })
  }
  if (indexed.size !== rpcOutputs.length) mismatches.push({ kind: 'raw-output-count', rpc: rpcOutputs.length, indexed: indexed.size })
  return mismatches
}

async function compareReceiveActivity(pool, receiveEvents) {
  if (!receiveEvents.length) return []
  const expected = receiveEvents.map((event) => ({
    address: event.address, txid: event.txid, block_height: event.blockHeight, tx_index: event.txIndex,
    io_index: event.ioIndex, asset_name: event.assetName, amount: event.amount,
  }))
  const { rows } = await pool.query(`
    WITH expected AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        address text, txid char(64), block_height bigint, tx_index integer,
        io_index integer, asset_name text, amount numeric
      )
    )
    SELECT e.*, a.id, a.amount AS indexed_amount, a.block_height AS indexed_height, a.tx_index AS indexed_tx_index
    FROM expected e LEFT JOIN address_activity a
      ON a.address = e.address AND a.txid = e.txid AND a.direction = 'receive'
      AND a.io_index = e.io_index AND a.asset_name = e.asset_name
  `, [JSON.stringify(expected)])
  const mismatches = []
  for (const row of rows) {
    const differences = []
    if (row.id == null) differences.push('missing-activity')
    else {
      if (decimalToAtomic(row.indexed_amount) !== decimalToAtomic(row.amount)) differences.push('amount')
      if (Number(row.indexed_height) !== Number(row.block_height)) differences.push('block-height')
      if (Number(row.indexed_tx_index) !== Number(row.tx_index)) differences.push('tx-index')
    }
    if (differences.length) mismatches.push({
      kind: 'receive-activity', address: row.address, txid: trimHash(row.txid),
      vout: row.io_index, asset: row.asset_name, differences,
    })
  }
  return mismatches
}

async function compareAssetTransfers(pool, rpcTransfers) {
  if (!rpcTransfers.length) return []
  const expected = rpcTransfers.map((transfer) => ({
    txid: transfer.txid, block_height: transfer.blockHeight, tx_index: transfer.txIndex,
    vout_index: transfer.voutIndex, asset_name: transfer.assetName, amount: transfer.amount,
    transfer_type: transfer.transferType, to_addresses: transfer.toAddresses,
  }))
  const { rows } = await pool.query(`
    WITH expected AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        txid char(64), block_height bigint, tx_index integer, vout_index integer,
        asset_name text, amount numeric, transfer_type text, to_addresses text[]
      )
    )
    SELECT e.*, a.id, a.amount AS indexed_amount, a.transfer_type AS indexed_type,
      a.to_addresses AS indexed_addresses, a.block_height AS indexed_height, a.tx_index AS indexed_tx_index
    FROM expected e LEFT JOIN asset_transfers a
      ON a.txid = e.txid AND a.vout_index = e.vout_index AND a.asset_name = e.asset_name
  `, [JSON.stringify(expected)])
  const mismatches = []
  for (const row of rows) {
    const differences = []
    if (row.id == null) differences.push('missing-transfer')
    else {
      if (decimalToAtomic(row.indexed_amount) !== decimalToAtomic(row.amount)) differences.push('amount')
      if (row.indexed_type !== row.transfer_type) differences.push('transfer-type')
      if (!sameArray(row.indexed_addresses, row.to_addresses)) differences.push('destination-addresses')
      if (Number(row.indexed_height) !== Number(row.block_height)) differences.push('block-height')
      if (Number(row.indexed_tx_index) !== Number(row.tx_index)) differences.push('tx-index')
    }
    if (differences.length) mismatches.push({
      kind: 'asset-transfer', txid: trimHash(row.txid), vout: row.vout_index,
      asset: row.asset_name, differences,
    })
  }
  return mismatches
}

async function compareCachedBalances(pool, receiveEvents, bestHeight, sampleLimit) {
  if (!sampleLimit) return []
  const unique = new Map()
  // Prefer asset-bearing addresses; they are the focus after activation and are
  // less likely than mining/exchange RVN addresses to have enormous histories.
  for (const event of [...receiveEvents].sort((a, b) => (a.assetName === 'RVN') - (b.assetName === 'RVN'))) {
    unique.set(`${event.address}\u0000${event.assetName}`, { address: event.address, asset_name: event.assetName })
    if (unique.size >= sampleLimit) break
  }
  const samples = [...unique.values()]
  if (!samples.length) return []
  const { rows } = await pool.query(`
    WITH samples AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(address text, asset_name text)
    ), ledger AS MATERIALIZED (
      SELECT s.address, s.asset_name,
        COALESCE(sum(CASE WHEN a.direction = 'receive' THEN a.amount ELSE -a.amount END), 0) AS balance,
        COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'receive'), 0) AS received,
        COALESCE(sum(a.amount) FILTER (WHERE a.direction = 'send'), 0) AS sent
      FROM samples s LEFT JOIN address_activity a
        ON a.address = s.address AND a.asset_name = s.asset_name AND a.block_height <= $2
      GROUP BY s.address, s.asset_name
    )
    SELECT l.*, b.balance AS cached_balance, b.received AS cached_received, b.sent AS cached_sent
    FROM ledger l LEFT JOIN address_balances b USING (address, asset_name)
  `, [JSON.stringify(samples), bestHeight])
  const mismatches = []
  for (const row of rows) {
    const differences = []
    if (row.cached_balance == null) differences.push('missing-cache-row')
    else {
      if (decimalToAtomic(row.balance) !== decimalToAtomic(row.cached_balance)) differences.push('balance')
      if (decimalToAtomic(row.received) !== decimalToAtomic(row.cached_received)) differences.push('received')
      if (decimalToAtomic(row.sent) !== decimalToAtomic(row.cached_sent)) differences.push('sent')
    }
    if (differences.length) mismatches.push({ kind: 'balance-cache', address: row.address, asset: row.asset_name, differences })
  }
  return mismatches
}

function printHelp() {
  console.log(`Usage: pnpm ops:reconcile

Read-only sampled consistency check using canonical getblockhash/getblock RPC.
It does not require addressindex or txindex and is safe while catching up.

Required: DATABASE_URL, RAVEN_RPC_URL, RAVEN_RPC_USER, RAVEN_RPC_PASSWORD
Optional:
  RECONCILE_BLOCK_SAMPLES=8
  RECONCILE_BALANCE_SAMPLES=6
  RECONCILE_TRANSFER_SAMPLES=16
  RECONCILE_RPC_BATCH_SIZE=4
  RECONCILE_RPC_TIMEOUT_MS=120000
  RECONCILE_DATABASE_TIMEOUT_MS=120000
  RECONCILE_REQUIRE_ASSET_SAMPLES=true
  RECONCILE_ASSET_GRACE_BLOCKS=1440`)
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return printHelp()
  const options = {
    blockSamples: integerSetting('RECONCILE_BLOCK_SAMPLES', 8, 1, 100),
    balanceSamples: integerSetting('RECONCILE_BALANCE_SAMPLES', 6, 0, 50),
    transferSamples: integerSetting('RECONCILE_TRANSFER_SAMPLES', 16, 0, 500),
    rpcBatchSize: integerSetting('RECONCILE_RPC_BATCH_SIZE', 4, 1, 50),
    databaseTimeout: integerSetting('RECONCILE_DATABASE_TIMEOUT_MS', 120_000, 1_000, 900_000),
    requireAssetSamples: booleanSetting('RECONCILE_REQUIRE_ASSET_SAMPLES', true),
    assetGraceBlocks: integerSetting('RECONCILE_ASSET_GRACE_BLOCKS', 1_440, 0, 100_000),
  }
  const pool = getPool()
  const client = await pool.connect()
  let inTransaction = false
  try {
    // One repeatable-read snapshot keeps sync_state, activity, and cached
    // balances coherent while the production indexer continues committing.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    inTransaction = true
    await client.query("SELECT set_config('statement_timeout', $1, true)", [`${options.databaseTimeout}ms`])
    const { rows } = await client.query(`
      SELECT best_height, trim(best_hash) AS best_hash, raw_height, target_height, status, last_error
      FROM sync_state WHERE id = $1
    `, [STATE_ID])
    if (!rows[0]) throw new Error('Ravencoin sync_state row is missing.')
    const bestHeight = Number(rows[0].best_height)
    if (bestHeight < ASSET_ACTIVATION_HEIGHT) {
      await client.query('COMMIT')
      inTransaction = false
      console.log(`RPC reconciliation skipped: processed tip ${bestHeight} has not reached asset activation ${ASSET_ACTIVATION_HEIGHT}.`)
      return
    }

    const rpc = new ExactRavenRpc()
    const transferSamples = await loadTransferSamples(client, bestHeight, options.transferSamples)
    const blocks = await loadCanonicalBlocks(client, rpc, bestHeight, transferSamples, options.blockSamples, options.rpcBatchSize)
    const facts = collectRpcFacts(blocks)
    const mismatchGroups = await Promise.all([
      compareRawOutputs(client, facts.outputs),
      compareReceiveActivity(client, facts.receiveEvents),
      compareAssetTransfers(client, facts.transfers),
      compareCachedBalances(client, facts.receiveEvents, bestHeight, options.balanceSamples),
    ])
    const mismatches = mismatchGroups.flat()
    for (const sample of transferSamples) {
      if (!facts.transfers.some((item) => transferKey(item) === transferKey({
        txid: sample.txid, voutIndex: sample.vout_index, assetName: sample.asset_name,
      }))) {
        mismatches.push({ kind: 'indexed-transfer-not-in-rpc-block', txid: sample.txid, vout: sample.vout_index, asset: sample.asset_name })
      }
    }
    if (
      options.requireAssetSamples
      && bestHeight >= ASSET_ACTIVATION_HEIGHT + options.assetGraceBlocks
      && facts.transfers.length === 0
    ) {
      mismatches.push({ kind: 'missing-asset-samples', message: 'Sampled canonical blocks contained no asset transfers.' })
    }
    await client.query('COMMIT')
    inTransaction = false

    console.log(
      `RPC reconciliation at processed block ${bestHeight}: ${blocks.length} canonical blocks, `
      + `${facts.outputs.length} outputs, ${facts.receiveEvents.length} receive events, and ${facts.transfers.length} asset transfers checked.`,
    )
    console.log(`Cached balances were checked against the indexed activity ledger for up to ${options.balanceSamples} RPC-observed address/asset pairs.`)
    if (mismatches.length) {
      for (const mismatch of mismatches) console.error(`MISMATCH ${JSON.stringify(mismatch)}`)
      throw new Error(`RPC reconciliation found ${mismatches.length} mismatch${mismatches.length === 1 ? '' : 'es'}.`)
    }
    console.log('RPC reconciliation passed.')
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

try {
  await main()
} catch (error) {
  console.error(`RPC reconciliation failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await closePool().catch(() => {})
}
