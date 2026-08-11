import { databaseHealth } from './db.mjs'
import { getLiveStatus } from './rpc.mjs'

const number = (value) => value == null ? null : Number(value)
const epoch = (value) => value == null ? null : Math.floor(new Date(value).getTime() / 1_000)
const cleanHash = (value) => value?.trim() ?? null

export function mintedSupplyAtHeight(height) {
  let blocks = Math.max(0, Math.floor(Number(height) || 0))
  let subsidy = 5_000
  let supply = 0
  while (blocks > 0 && subsidy >= 1 / 100_000_000) {
    const epochBlocks = Math.min(blocks, 2_100_000)
    supply += epochBlocks * subsidy
    blocks -= epochBlocks
    subsidy /= 2
  }
  return supply
}

function mapTransaction(row) {
  return {
    txid: cleanHash(row.txid),
    blockHash: cleanHash(row.block_hash),
    blockHeight: number(row.block_height),
    confirmations: number(row.confirmations) ?? 0,
    time: epoch(row.time),
    size: number(row.size),
    vsize: number(row.vsize),
    version: number(row.version),
    locktime: number(row.locktime),
    totalInput: number(row.total_input_rvn),
    totalOutput: number(row.total_output_rvn),
    fee: number(row.fee_rvn),
  }
}

function mapBlock(row, transactions = []) {
  return {
    height: number(row.height),
    hash: cleanHash(row.hash),
    time: epoch(row.time),
    size: number(row.size),
    txCount: number(row.tx_count),
    confirmations: number(row.confirmations),
    difficulty: number(row.difficulty),
    version: number(row.version),
    merkleRoot: cleanHash(row.merkle_root),
    nonce: number(row.nonce),
    bits: row.bits,
    previousBlockHash: cleanHash(row.previous_hash),
    nextBlockHash: cleanHash(row.next_hash),
    transactions,
  }
}

function mapAsset(row) {
  return {
    name: row.name,
    amount: number(row.amount) ?? 0,
    units: number(row.units) ?? 0,
    reissuable: Boolean(row.reissuable),
    hasIpfs: Boolean(row.has_ipfs),
    ipfsHash: row.ipfs_hash ?? row.txid_hash ?? null,
    blockHeight: number(row.created_height),
    blockHash: cleanHash(row.created_hash),
  }
}

export async function getIndexedStatus(pool, rpc) {
  const [database, live] = await Promise.all([databaseHealth(pool), getLiveStatus(rpc)])
  const indexedHeight = number(database.best_height) ?? -1
  const targetHeight = live.blocks
  const indexedBlocks = number(database.indexed_blocks) ?? 0
  const startedAt = epoch(database.started_at)
  const lastIndexedAt = epoch(database.indexed_at)
  const elapsedSeconds = startedAt != null && lastIndexedAt != null ? Math.max(1, lastIndexedAt - startedAt) : 0
  const blocksPerSecond = elapsedSeconds > 0 ? indexedBlocks / elapsedSeconds : 0
  const blocksRemaining = Math.max(0, targetHeight - indexedHeight)
  return {
    ...live,
    blocks: Math.max(0, indexedHeight),
    chainTip: live.blocks,
    bestBlockHash: cleanHash(database.best_hash) ?? live.bestBlockHash,
    indexer: {
      status: database.status,
      indexedHeight,
      rawHeight: number(database.raw_height) ?? indexedHeight,
      targetHeight,
      progress: targetHeight > 0 ? Math.max(0, Math.min(1, (indexedHeight + 1) / (targetHeight + 1))) : 0,
      indexedBlocks,
      stagedBlocks: number(database.staged_blocks) ?? indexedBlocks,
      indexedTransactions: number(database.indexed_transactions) ?? 0,
      indexedAssets: number(database.indexed_assets) ?? 0,
      databaseBytes: number(database.database_bytes) ?? 0,
      latencyMs: database.latencyMs,
      blocksRemaining,
      blocksPerSecond,
      estimatedSecondsRemaining: blocksPerSecond > 0 ? blocksRemaining / blocksPerSecond : null,
      startedAt,
      lastIndexedAt,
      lastError: database.last_error,
      updatedAt: database.updated_at,
    },
  }
}

export async function getIndexedBlocks(pool, limit = 20, start) {
  const { rows: tipRows } = await pool.query('SELECT best_height FROM sync_state WHERE id = $1', ['ravencoin-mainnet'])
  const tip = number(tipRows[0]?.best_height) ?? -1
  const upper = start == null ? tip : Math.min(Number(start), tip)
  const { rows } = await pool.query(`
    SELECT b.*, n.hash AS next_hash, ($2::bigint - b.height + 1) AS confirmations
    FROM blocks b LEFT JOIN blocks n ON n.height = b.height + 1
    WHERE b.height <= $1 ORDER BY b.height DESC LIMIT $3
  `, [upper, tip, limit])
  return rows.map((row) => mapBlock(row))
}

export async function getIndexedTransactions(pool, limit = 12) {
  const { rows } = await pool.query(`
    SELECT t.*, (s.best_height - t.block_height + 1) AS confirmations
    FROM transactions t CROSS JOIN sync_state s
    WHERE s.id = 'ravencoin-mainnet' AND t.block_height <= s.best_height
    ORDER BY t.block_height DESC, t.tx_index DESC
    LIMIT $1
  `, [limit])
  return rows.map(mapTransaction)
}

export async function getIndexedNetworkStats(pool) {
  const [{ rows }, { rows: historyRows }] = await Promise.all([pool.query(`
    WITH recent_blocks AS MATERIALIZED (
      SELECT b.height, b.time, b.size, b.tx_count FROM blocks b CROSS JOIN sync_state s
      WHERE s.id = 'ravencoin-mainnet' AND b.height <= s.best_height
        AND b.time >= (SELECT max(x.time) - interval '24 hours' FROM blocks x WHERE x.height <= s.best_height)
    ), rollup AS (
      SELECT min(height) AS start_height, max(height) AS end_height,
        min(time) AS window_start, max(time) AS window_end,
        count(*) AS window_blocks, COALESCE(sum(tx_count), 0) AS window_transactions,
        COALESCE(avg(size), 0) AS average_block_size,
        COALESCE(avg(tx_count), 0) AS average_transactions_per_block
      FROM recent_blocks
    )
    SELECT r.*,
      EXTRACT(EPOCH FROM (r.window_end - r.window_start)) / NULLIF(r.window_blocks - 1, 0) AS average_block_time_seconds,
      r.window_transactions / NULLIF(EXTRACT(EPOCH FROM (r.window_end - r.window_start)), 0) AS transactions_per_second,
      (SELECT count(DISTINCT address) FROM address_transactions WHERE block_height >= r.start_height) AS active_addresses,
      (SELECT COALESCE(avg(total_output_rvn), 0) FROM transactions WHERE block_height BETWEEN r.start_height AND r.end_height AND tx_index = 0) AS average_block_reward,
      (SELECT COALESCE(sum(fee_rvn), 0) FROM transactions WHERE block_height BETWEEN r.start_height AND r.end_height) AS total_fees,
      (SELECT COALESCE(sum(total_output_rvn), 0) FROM transactions WHERE block_height BETWEEN r.start_height AND r.end_height) AS output_volume,
      (SELECT count(*) FROM transactions WHERE block_height <= r.end_height) AS total_transactions,
      (SELECT count(*) FROM address_balances WHERE asset_name = 'RVN') AS tracked_addresses,
      (SELECT count(*) FROM assets) AS total_assets
    FROM rollup r
  `), pool.query(`
    WITH bounds AS (
      SELECT date_trunc('hour', max(b.time)) AS end_hour, s.best_height
      FROM blocks b CROSS JOIN sync_state s WHERE s.id = 'ravencoin-mainnet' AND b.height <= s.best_height
      GROUP BY s.best_height
    ), hours AS (
      SELECT generate_series(end_hour - interval '23 hours', end_hour, interval '1 hour') AS hour
      FROM bounds WHERE end_hour IS NOT NULL
    ), recent_blocks AS MATERIALIZED (
      SELECT height, date_trunc('hour', time) AS hour, tx_count, difficulty
      FROM blocks WHERE height <= (SELECT best_height FROM bounds)
        AND time >= (SELECT end_hour - interval '23 hours' FROM bounds)
    ), block_activity AS (
      SELECT hour, count(*) AS blocks, COALESCE(sum(tx_count), 0) AS transactions,
        COALESCE(avg(difficulty), 0) AS difficulty
      FROM recent_blocks GROUP BY hour
    ), address_activity AS (
      SELECT b.hour, count(DISTINCT a.address) AS active_addresses
      FROM recent_blocks b JOIN address_transactions a ON a.block_height = b.height
      GROUP BY b.hour
    )
    SELECT h.hour, COALESCE(b.blocks, 0) AS blocks,
      COALESCE(b.transactions, 0) AS transactions,
      COALESCE(a.active_addresses, 0) AS active_addresses,
      COALESCE(b.difficulty, 0) AS difficulty
    FROM hours h
    LEFT JOIN block_activity b USING (hour)
    LEFT JOIN address_activity a USING (hour)
    ORDER BY h.hour
  `)])
  const row = rows[0] ?? {}
  const startHeight = number(row.start_height) ?? 0
  const endHeight = number(row.end_height) ?? 0
  return {
    windowStartHeight: startHeight,
    windowEndHeight: endHeight,
    windowStart: epoch(row.window_start),
    windowEnd: epoch(row.window_end),
    windowBlocks: number(row.window_blocks) ?? 0,
    windowTransactions: number(row.window_transactions) ?? 0,
    activeAddresses: number(row.active_addresses) ?? 0,
    averageBlockTimeSeconds: number(row.average_block_time_seconds) ?? 0,
    averageBlockSize: number(row.average_block_size) ?? 0,
    averageTransactionsPerBlock: number(row.average_transactions_per_block) ?? 0,
    transactionsPerSecond: number(row.transactions_per_second) ?? 0,
    averageBlockReward: number(row.average_block_reward) ?? 0,
    minedRvn: mintedSupplyAtHeight(endHeight) - mintedSupplyAtHeight(startHeight - 1),
    totalFees: number(row.total_fees) ?? 0,
    outputVolume: number(row.output_volume) ?? 0,
    circulatingSupply: mintedSupplyAtHeight(endHeight),
    totalTransactions: number(row.total_transactions) ?? 0,
    trackedAddresses: number(row.tracked_addresses) ?? 0,
    totalAssets: number(row.total_assets) ?? 0,
    history: historyRows.map((point) => ({
      timestamp: epoch(point.hour),
      blocks: number(point.blocks) ?? 0,
      transactions: number(point.transactions) ?? 0,
      activeAddresses: number(point.active_addresses) ?? 0,
      difficulty: number(point.difficulty) ?? 0,
    })),
  }
}

export async function getIndexedAddresses(pool, limit = 50, offset = 0) {
  const [{ rows }, { rows: distributionRows }] = await Promise.all([
    pool.query(`
      WITH ranked AS MATERIALIZED (
        SELECT address, balance, received, sent, updated_height
        FROM address_balances
        WHERE asset_name = 'RVN' AND balance > 0
        ORDER BY balance DESC, address
        LIMIT $1 OFFSET $2
      ), activity AS (
        SELECT a.address, count(*) AS transaction_count, max(a.block_height) AS last_activity_height
        FROM address_transactions a JOIN ranked r USING (address)
        GROUP BY a.address
      ), mined AS (
        SELECT oa.address, count(DISTINCT t.block_height) AS blocks_mined
        FROM output_addresses oa
        JOIN transactions t USING (txid)
        JOIN ranked r USING (address)
        WHERE t.tx_index = 0
        GROUP BY oa.address
      )
      SELECT r.*, COALESCE(a.transaction_count, 0) AS transaction_count,
        COALESCE(a.last_activity_height, r.updated_height) AS last_activity_height,
        COALESCE(m.blocks_mined, 0) AS blocks_mined
      FROM ranked r
      LEFT JOIN activity a USING (address)
      LEFT JOIN mined m USING (address)
      ORDER BY r.balance DESC, r.address
    `, [limit, offset]),
    pool.query(`
      SELECT count(*) AS total_addresses, COALESCE(sum(balance), 0) AS total_balance,
        count(*) FILTER (WHERE balance >= 1) AS over_one,
        count(*) FILTER (WHERE balance >= 100) AS over_hundred,
        count(*) FILTER (WHERE balance >= 1000) AS over_thousand,
        count(*) FILTER (WHERE balance >= 10000) AS over_ten_thousand,
        count(*) FILTER (WHERE balance >= 100000) AS over_hundred_thousand,
        count(*) FILTER (WHERE balance >= 1000000) AS over_million
      FROM address_balances WHERE asset_name = 'RVN' AND balance > 0
    `),
  ])
  const distribution = distributionRows[0] ?? {}
  const totalBalance = number(distribution.total_balance) ?? 0
  return {
    items: rows.map((row, index) => ({
      rank: offset + index + 1,
      address: row.address,
      balance: number(row.balance) ?? 0,
      received: number(row.received) ?? 0,
      sent: number(row.sent) ?? 0,
      transactionCount: number(row.transaction_count) ?? 0,
      blocksMined: number(row.blocks_mined) ?? 0,
      lastActivityHeight: number(row.last_activity_height),
      share: totalBalance > 0 ? (number(row.balance) ?? 0) / totalBalance : 0,
    })),
    total: number(distribution.total_addresses) ?? 0,
    totalBalance,
    thresholds: [
      { balance: 1, addresses: number(distribution.over_one) ?? 0 },
      { balance: 100, addresses: number(distribution.over_hundred) ?? 0 },
      { balance: 1_000, addresses: number(distribution.over_thousand) ?? 0 },
      { balance: 10_000, addresses: number(distribution.over_ten_thousand) ?? 0 },
      { balance: 100_000, addresses: number(distribution.over_hundred_thousand) ?? 0 },
      { balance: 1_000_000, addresses: number(distribution.over_million) ?? 0 },
    ],
  }
}

export async function getIndexedBlock(pool, id) {
  const isHeight = /^\d+$/.test(String(id))
  const { rows } = await pool.query(`
    SELECT b.*, n.hash AS next_hash, (s.best_height - b.height + 1) AS confirmations
    FROM blocks b CROSS JOIN sync_state s LEFT JOIN blocks n ON n.height = b.height + 1
    WHERE s.id = 'ravencoin-mainnet' AND b.height <= s.best_height AND ${isHeight ? 'b.height = $1' : 'b.hash = $1'} LIMIT 1
  `, [isHeight ? Number(id) : id])
  if (!rows[0]) throw Object.assign(new Error('Block not found.'), { status: 404, code: -5 })
  const { rows: transactions } = await pool.query(`
    SELECT t.*, (s.best_height - t.block_height + 1) AS confirmations
    FROM transactions t CROSS JOIN sync_state s
    WHERE s.id = 'ravencoin-mainnet' AND t.block_height = $1 ORDER BY t.tx_index
  `, [rows[0].height])
  return mapBlock(rows[0], transactions.map(mapTransaction))
}

export async function getIndexedTransaction(pool, txid) {
  const { rows } = await pool.query(`
    SELECT t.*, (s.best_height - t.block_height + 1) AS confirmations
    FROM transactions t CROSS JOIN sync_state s
    WHERE s.id = 'ravencoin-mainnet' AND t.block_height <= s.best_height AND t.txid = $1
  `, [txid])
  if (!rows[0]) throw Object.assign(new Error('Transaction not found.'), { status: 404, code: -5 })
  const [{ rows: inputs }, { rows: outputs }] = await Promise.all([
    pool.query('SELECT * FROM tx_inputs WHERE txid = $1 ORDER BY vin_index', [txid]),
    pool.query(`
      SELECT o.*, COALESCE(array_agg(a.address) FILTER (WHERE a.address IS NOT NULL), '{}') AS addresses
      FROM tx_outputs o LEFT JOIN output_addresses a USING (txid, vout_index)
      WHERE o.txid = $1 GROUP BY o.txid, o.vout_index ORDER BY o.vout_index
    `, [txid]),
  ])
  return {
    ...mapTransaction(rows[0]),
    vin: inputs.map((input) => ({
      txid: cleanHash(input.prev_txid), vout: number(input.prev_vout), coinbase: input.coinbase,
      sequence: number(input.sequence), address: input.addresses?.[0] ?? null, addresses: input.addresses,
      value: number(input.value_rvn), asset: input.asset_name ? { name: input.asset_name, amount: number(input.asset_amount) } : null,
    })),
    vout: outputs.map((output) => ({
      n: number(output.vout_index), value: number(output.value_rvn), addresses: output.addresses,
      type: output.script_type, asset: output.asset_name ? { name: output.asset_name, amount: number(output.asset_amount), type: output.asset_type } : null,
    })),
  }
}

export async function getIndexedAddress(pool, address) {
  const [{ rows: balances }, { rows: countRows }, { rows: utxos }, { rows: recent }] = await Promise.all([
    pool.query('SELECT * FROM address_balances WHERE address = $1 ORDER BY asset_name = \'RVN\' DESC, balance DESC', [address]),
    pool.query('SELECT count(*) AS count FROM address_transactions WHERE address = $1', [address]),
    pool.query(`
      SELECT o.txid, o.vout_index, o.value_rvn, o.asset_name, o.asset_amount, t.block_height
      FROM output_addresses a JOIN tx_outputs o USING (txid, vout_index) JOIN transactions t USING (txid)
      CROSS JOIN sync_state s
      WHERE s.id = 'ravencoin-mainnet' AND t.block_height <= s.best_height
        AND a.address = $1 AND o.spent_by_txid IS NULL ORDER BY t.block_height DESC LIMIT 100
    `, [address]),
    pool.query(`
      SELECT t.*, (s.best_height - t.block_height + 1) AS confirmations
      FROM address_transactions a JOIN transactions t USING (txid) CROSS JOIN sync_state s
      WHERE s.id = 'ravencoin-mainnet' AND a.address = $1
      ORDER BY a.block_height DESC, a.tx_index DESC LIMIT 25
    `, [address]),
  ])
  const mapped = balances.map((row) => ({ assetName: row.asset_name, balance: number(row.balance) ?? 0, received: number(row.received) ?? 0, sent: number(row.sent) ?? 0 }))
  const raven = mapped.find((balance) => balance.assetName === 'RVN') ?? { balance: 0, received: 0, sent: 0 }
  return {
    address,
    balance: raven.balance,
    received: raven.received,
    sent: raven.sent,
    transactionCount: number(countRows[0]?.count) ?? 0,
    balances: mapped,
    utxos: utxos.map((output) => ({
      address, assetName: output.asset_name ?? 'RVN', txid: cleanHash(output.txid), outputIndex: number(output.vout_index),
      amount: number(output.asset_name ? output.asset_amount : output.value_rvn), height: number(output.block_height),
    })),
    transactions: recent.map(mapTransaction),
  }
}

export async function getIndexedAssets(pool, query = '', limit = 50, offset = 0) {
  const { rows } = await pool.query(`
    SELECT * FROM assets WHERE name ILIKE $1 ORDER BY name LIMIT $2 OFFSET $3
  `, [`${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`, limit, offset])
  return rows.map(mapAsset)
}

export async function getIndexedAsset(pool, name) {
  const { rows } = await pool.query('SELECT * FROM assets WHERE name = $1', [decodeURIComponent(name).toUpperCase()])
  if (!rows[0]) throw Object.assign(new Error('Asset not found.'), { status: 404, code: -5 })
  const { rows: transfers } = await pool.query(`
    SELECT a.*, t.time FROM asset_transfers a JOIN transactions t USING (txid)
    WHERE a.asset_name = $1 ORDER BY a.block_height DESC, a.tx_index DESC LIMIT 50
  `, [rows[0].name])
  return {
    ...mapAsset(rows[0]),
    transfers: transfers.map((transfer) => ({
      txid: cleanHash(transfer.txid), blockHeight: number(transfer.block_height), time: epoch(transfer.time),
      outputIndex: number(transfer.vout_index), type: transfer.transfer_type, amount: number(transfer.amount),
      fromAddresses: transfer.from_addresses ?? [], toAddresses: transfer.to_addresses ?? [],
    })),
  }
}

export async function searchIndexed(pool, query) {
  if (/^\d+$/.test(query)) return { type: 'block', path: `/block/${query}` }
  if (/^[a-fA-F0-9]{64}$/.test(query)) {
    const { rows } = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM blocks b CROSS JOIN sync_state s
        WHERE s.id = 'ravencoin-mainnet' AND b.height <= s.best_height AND b.hash = $1
      ) AS is_block
    `, [query])
    return rows[0].is_block ? { type: 'block', path: `/block/${query}` } : { type: 'transaction', path: `/tx/${query}` }
  }
  if (/^[Rr][1-9A-HJ-NP-Za-km-z]{24,35}$/.test(query)) return { type: 'address', path: `/address/${query}` }
  if (/^[A-Za-z0-9._#$!/~^-]{1,32}$/.test(query)) return { type: 'asset', path: `/asset/${encodeURIComponent(query.toUpperCase())}` }
  throw Object.assign(new Error('That search format is not recognized.'), { status: 400, code: -8 })
}
