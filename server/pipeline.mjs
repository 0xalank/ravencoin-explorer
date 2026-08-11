import { atomicToDecimal, decimalToAtomic, normalizeOutput } from './indexer-utils.mjs'

const STATE_ID = 'ravencoin-mainnet'
const asJson = (rows) => JSON.stringify(rows)

function indexerWorkMem() {
  const value = (process.env.INDEXER_WORK_MEM || '256MB').trim()
  if (!/^\d+(?:kB|MB|GB)$/i.test(value)) throw new Error(`Invalid INDEXER_WORK_MEM value: ${value}`)
  return value
}

async function configureRebuildableTransaction(client) {
  await client.query('SET LOCAL synchronous_commit = off')
  await client.query("SELECT set_config('work_mem', $1, true)", [indexerWorkMem()])
}

async function insertJson(client, rows, sql) {
  if (rows.length) await client.query(sql, [asJson(rows)])
}

function collectRawRows(blocks) {
  const blockRows = []
  const transactionRows = []
  const outputRows = []
  const outputAddressRows = []
  const inputRows = []

  for (const block of blocks) {
    blockRows.push({
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
    })
    for (const [txIndex, transaction] of (block.tx ?? []).entries()) {
      const outputs = (transaction.vout ?? []).map(normalizeOutput)
      const totalOutput = outputs.reduce((total, output) => total + decimalToAtomic(output.value), 0n)
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
      for (const [vinIndex, input] of (transaction.vin ?? []).entries()) {
        inputRows.push({
          txid: transaction.txid,
          vin_index: vinIndex,
          prev_txid: input.txid ?? null,
          prev_vout: input.vout ?? null,
          coinbase: input.coinbase ?? null,
          sequence: input.sequence ?? null,
        })
      }
    }
  }
  return { blockRows, transactionRows, outputRows, outputAddressRows, inputRows }
}

export async function stageRawBlockBatch(pool, blocks, expectedPreviousHash) {
  if (!blocks.length) return
  for (let index = 0; index < blocks.length; index += 1) {
    const expected = index === 0 ? expectedPreviousHash : blocks[index - 1].hash
    if (blocks[index].height > 0 && blocks[index].previousblockhash !== expected) throw new Error(`Raw chain discontinuity at height ${blocks[index].height}`)
  }
  const rows = collectRawRows(blocks)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await configureRebuildableTransaction(client)
    await insertJson(client, rows.blockRows, `
      INSERT INTO blocks (height, hash, previous_hash, time, size, weight, tx_count, confirmations, difficulty, version, merkle_root, nonce, bits, chainwork)
      SELECT height, hash, previous_hash, time, size, weight, tx_count, confirmations, difficulty, version, merkle_root, nonce, bits, chainwork
      FROM jsonb_to_recordset($1::jsonb) AS x(
        height bigint, hash char(64), previous_hash char(64), time timestamptz, size integer, weight integer,
        tx_count integer, confirmations integer, difficulty numeric, version bigint, merkle_root char(64), nonce numeric,
        bits varchar(16), chainwork text
      ) ON CONFLICT (height) DO NOTHING
    `)
    await insertJson(client, rows.transactionRows, `
      INSERT INTO transactions (txid, block_height, block_hash, tx_index, time, size, vsize, weight, version, locktime, total_output_rvn)
      SELECT txid, block_height, block_hash, tx_index, time, size, vsize, weight, version, locktime, total_output_rvn
      FROM jsonb_to_recordset($1::jsonb) AS x(
        txid char(64), block_height bigint, block_hash char(64), tx_index integer, time timestamptz,
        size integer, vsize integer, weight integer, version integer, locktime bigint, total_output_rvn numeric
      ) ON CONFLICT (txid) DO NOTHING
    `)
    await insertJson(client, rows.outputRows, `
      INSERT INTO tx_outputs (txid, vout_index, value_rvn, script_type, script_hex, asset_name, asset_amount, asset_type)
      SELECT txid, vout_index, value_rvn, script_type, script_hex, asset_name, asset_amount, asset_type
      FROM jsonb_to_recordset($1::jsonb) AS x(
        txid char(64), vout_index integer, value_rvn numeric, script_type text, script_hex text,
        asset_name text, asset_amount numeric, asset_type text
      ) ON CONFLICT (txid, vout_index) DO NOTHING
    `)
    await insertJson(client, rows.outputAddressRows, `
      INSERT INTO output_addresses (txid, vout_index, address)
      SELECT txid, vout_index, address
      FROM jsonb_to_recordset($1::jsonb) AS x(txid char(64), vout_index integer, address text)
      ON CONFLICT DO NOTHING
    `)
    await insertJson(client, rows.inputRows, `
      INSERT INTO tx_inputs (txid, vin_index, prev_txid, prev_vout, coinbase, sequence)
      SELECT txid, vin_index, prev_txid, prev_vout, coinbase, sequence
      FROM jsonb_to_recordset($1::jsonb) AS x(
        txid char(64), vin_index integer, prev_txid char(64), prev_vout integer, coinbase text, sequence numeric
      ) ON CONFLICT (txid, vin_index) DO NOTHING
    `)
    const tip = blocks.at(-1)
    await client.query(`
      UPDATE sync_state SET raw_height = $2, raw_hash = $3, raw_indexed_at = now(), status = 'syncing', last_error = NULL, updated_at = now()
      WHERE id = $1
    `, [STATE_ID, tip.height, tip.hash])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function aggregateBlockRange(pool, firstHeight, lastHeight) {
  if (lastHeight < firstHeight) return { assetNames: [], transactions: 0 }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await configureRebuildableTransaction(client)
    const { rows: stateRows } = await client.query('SELECT best_height, raw_height FROM sync_state WHERE id = $1', [STATE_ID])
    const state = stateRows[0]
    if (!state || Number(state.best_height) + 1 !== firstHeight) throw new Error(`Aggregation checkpoint mismatch at height ${firstHeight}`)
    if (lastHeight > Number(state.raw_height)) throw new Error(`Cannot aggregate past raw height ${state.raw_height}`)

    // Capture only activity inserted by this transaction. Downstream address rows and
    // balance deltas can then be derived from this bounded batch instead of scanning
    // the ever-growing address_activity table by block height.
    await client.query(`
      CREATE TEMP TABLE IF NOT EXISTS batch_address_activity (
        address text NOT NULL,
        txid char(64) NOT NULL,
        block_height bigint NOT NULL,
        tx_index integer NOT NULL,
        io_index integer NOT NULL,
        direction text NOT NULL,
        asset_name text NOT NULL,
        amount numeric(38, 8) NOT NULL
      ) ON COMMIT DELETE ROWS
    `)

    // Resolve every input through the composite tx_outputs(txid, vout_index) primary key.
    await client.query(`
      WITH resolved AS MATERIALIZED (
        SELECT i.txid, i.vin_index, o.value_rvn, o.asset_name, o.asset_amount,
          COALESCE(array_agg(a.address) FILTER (WHERE a.address IS NOT NULL), '{}') AS addresses
        FROM transactions t
        JOIN tx_inputs i ON i.txid = t.txid
        JOIN tx_outputs o ON o.txid = i.prev_txid AND o.vout_index = i.prev_vout
        LEFT JOIN output_addresses a ON a.txid = o.txid AND a.vout_index = o.vout_index
        WHERE t.block_height BETWEEN $1 AND $2
        GROUP BY i.txid, i.vin_index, o.value_rvn, o.asset_name, o.asset_amount
      )
      UPDATE tx_inputs i SET addresses = r.addresses, value_rvn = r.value_rvn,
        asset_name = r.asset_name, asset_amount = r.asset_amount
      FROM resolved r WHERE i.txid = r.txid AND i.vin_index = r.vin_index
    `, [firstHeight, lastHeight])

    await client.query(`
      UPDATE tx_outputs o SET spent_by_txid = i.txid, spent_by_vin = i.vin_index
      FROM tx_inputs i JOIN transactions t ON t.txid = i.txid
      WHERE t.block_height BETWEEN $1 AND $2 AND i.prev_txid IS NOT NULL
        AND o.txid = i.prev_txid AND o.vout_index = i.prev_vout
    `, [firstHeight, lastHeight])

    const { rowCount: transactionCount } = await client.query(`
      WITH totals AS MATERIALIZED (
        SELECT t.txid,
          bool_or(i.coinbase IS NOT NULL) AS is_coinbase,
          bool_or(i.prev_txid IS NOT NULL AND i.value_rvn IS NULL) AS has_missing_input,
          COALESCE(sum(i.value_rvn) FILTER (WHERE i.prev_txid IS NOT NULL), 0) AS total_input
        FROM transactions t JOIN tx_inputs i ON i.txid = t.txid
        WHERE t.block_height BETWEEN $1 AND $2 GROUP BY t.txid
      )
      UPDATE transactions t SET
        total_input_rvn = CASE WHEN x.is_coinbase OR x.has_missing_input THEN NULL ELSE x.total_input END,
        fee_rvn = CASE WHEN x.is_coinbase OR x.has_missing_input THEN NULL ELSE x.total_input - t.total_output_rvn END
      FROM totals x WHERE t.txid = x.txid
    `, [firstHeight, lastHeight])

    await client.query(`
      WITH inserted AS (
        INSERT INTO address_activity (address, txid, block_height, tx_index, io_index, direction, asset_name, amount)
        SELECT a.address, t.txid, t.block_height, t.tx_index, o.vout_index, 'receive', 'RVN', o.value_rvn
        FROM transactions t JOIN tx_outputs o USING (txid) JOIN output_addresses a USING (txid, vout_index)
        WHERE t.block_height BETWEEN $1 AND $2 AND o.value_rvn <> 0
        UNION ALL
        SELECT a.address, t.txid, t.block_height, t.tx_index, o.vout_index, 'receive', o.asset_name, o.asset_amount
        FROM transactions t JOIN tx_outputs o USING (txid) JOIN output_addresses a USING (txid, vout_index)
        WHERE t.block_height BETWEEN $1 AND $2 AND o.asset_name IS NOT NULL AND o.asset_amount <> 0
        ON CONFLICT (address, txid, direction, io_index, asset_name) DO NOTHING
        RETURNING address, txid, block_height, tx_index, io_index, direction, asset_name, amount
      )
      INSERT INTO batch_address_activity (address, txid, block_height, tx_index, io_index, direction, asset_name, amount)
      SELECT address, txid, block_height, tx_index, io_index, direction, asset_name, amount FROM inserted
    `, [firstHeight, lastHeight])

    await client.query(`
      WITH inserted AS (
        INSERT INTO address_activity (address, txid, block_height, tx_index, io_index, direction, asset_name, amount)
        SELECT a.address, t.txid, t.block_height, t.tx_index, i.vin_index, 'send', 'RVN', i.value_rvn
        FROM transactions t JOIN tx_inputs i USING (txid) CROSS JOIN LATERAL unnest(i.addresses) AS a(address)
        WHERE t.block_height BETWEEN $1 AND $2 AND i.value_rvn <> 0
        UNION ALL
        SELECT a.address, t.txid, t.block_height, t.tx_index, i.vin_index, 'send', i.asset_name, i.asset_amount
        FROM transactions t JOIN tx_inputs i USING (txid) CROSS JOIN LATERAL unnest(i.addresses) AS a(address)
        WHERE t.block_height BETWEEN $1 AND $2 AND i.asset_name IS NOT NULL AND i.asset_amount <> 0
        ON CONFLICT (address, txid, direction, io_index, asset_name) DO NOTHING
        RETURNING address, txid, block_height, tx_index, io_index, direction, asset_name, amount
      )
      INSERT INTO batch_address_activity (address, txid, block_height, tx_index, io_index, direction, asset_name, amount)
      SELECT address, txid, block_height, tx_index, io_index, direction, asset_name, amount FROM inserted
    `, [firstHeight, lastHeight])

    await client.query(`
      INSERT INTO address_transactions (address, txid, block_height, tx_index)
      SELECT DISTINCT address, txid, block_height, tx_index FROM batch_address_activity
      ON CONFLICT DO NOTHING
    `)

    await client.query(`
      WITH changes AS MATERIALIZED (
        SELECT address, asset_name,
          sum(CASE WHEN direction = 'receive' THEN amount ELSE -amount END) AS balance,
          sum(CASE WHEN direction = 'receive' THEN amount ELSE 0 END) AS received,
          sum(CASE WHEN direction = 'send' THEN amount ELSE 0 END) AS sent,
          max(block_height) AS updated_height
        FROM batch_address_activity GROUP BY address, asset_name
      )
      INSERT INTO address_balances (address, asset_name, balance, received, sent, updated_height)
      SELECT address, asset_name, balance, received, sent, updated_height FROM changes
      ON CONFLICT (address, asset_name) DO UPDATE SET
        balance = address_balances.balance + EXCLUDED.balance,
        received = address_balances.received + EXCLUDED.received,
        sent = address_balances.sent + EXCLUDED.sent,
        updated_height = GREATEST(address_balances.updated_height, EXCLUDED.updated_height)
    `)

    const { rows: assetRows } = await client.query(`
      WITH input_assets AS MATERIALIZED (
        SELECT i.txid, previous.asset_name,
          COALESCE(array_agg(DISTINCT a.address) FILTER (WHERE a.address IS NOT NULL), '{}') AS from_addresses
        FROM transactions t JOIN tx_inputs i USING (txid)
        JOIN tx_outputs previous ON previous.txid = i.prev_txid AND previous.vout_index = i.prev_vout
        LEFT JOIN output_addresses a ON a.txid = previous.txid AND a.vout_index = previous.vout_index
        WHERE t.block_height BETWEEN $1 AND $2 AND previous.asset_name IS NOT NULL
        GROUP BY i.txid, previous.asset_name
      ), output_assets AS MATERIALIZED (
        SELECT o.txid, o.vout_index,
          COALESCE(array_agg(a.address) FILTER (WHERE a.address IS NOT NULL), '{}') AS to_addresses
        FROM transactions t JOIN tx_outputs o USING (txid)
        LEFT JOIN output_addresses a USING (txid, vout_index)
        WHERE t.block_height BETWEEN $1 AND $2 AND o.asset_name IS NOT NULL
        GROUP BY o.txid, o.vout_index
      ), inserted AS (
        INSERT INTO asset_transfers (asset_name, txid, block_height, tx_index, vout_index, transfer_type, amount, from_addresses, to_addresses)
        SELECT o.asset_name, t.txid, t.block_height, t.tx_index, o.vout_index,
          COALESCE(o.asset_type, 'transfer'), o.asset_amount, COALESCE(i.from_addresses, '{}'), a.to_addresses
        FROM transactions t JOIN tx_outputs o USING (txid)
        JOIN output_assets a ON a.txid = o.txid AND a.vout_index = o.vout_index
        LEFT JOIN input_assets i ON i.txid = o.txid AND i.asset_name = o.asset_name
        WHERE t.block_height BETWEEN $1 AND $2 AND o.asset_name IS NOT NULL
        ON CONFLICT (txid, vout_index, asset_name) DO NOTHING RETURNING asset_name
      )
      SELECT DISTINCT asset_name FROM inserted
    `, [firstHeight, lastHeight])

    if (assetRows.length) await client.query(`
      INSERT INTO asset_sync_queue (asset_name, seen_height)
      SELECT unnest($1::text[]), $2::bigint
      ON CONFLICT (asset_name) DO UPDATE SET seen_height = GREATEST(asset_sync_queue.seen_height, EXCLUDED.seen_height), updated_at = now()
    `, [assetRows.map((row) => row.asset_name), lastHeight])

    const { rows: tipRows } = await client.query('SELECT hash FROM blocks WHERE height = $1', [lastHeight])
    if (!tipRows[0]) throw new Error(`Missing staged block ${lastHeight}`)
    await client.query(`
      UPDATE sync_state SET best_height = $2, best_hash = $3, indexed_at = now(), status = 'syncing', last_error = NULL, updated_at = now()
      WHERE id = $1
    `, [STATE_ID, lastHeight, tipRows[0].hash.trim()])
    await client.query('COMMIT')
    return { assetNames: assetRows.map((row) => row.asset_name), transactions: transactionCount ?? 0 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
