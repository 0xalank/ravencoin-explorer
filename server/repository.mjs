import { databaseHealth } from './db.mjs'
import { getLiveStatus } from './rpc.mjs'

const number = (value) => value == null ? null : Number(value)
const epoch = (value) => value == null ? null : Math.floor(new Date(value).getTime() / 1_000)
const cleanHash = (value) => value?.trim() ?? null

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
  const targetHeight = number(database.target_height) ?? live.blocks
  return {
    ...live,
    blocks: Math.max(0, indexedHeight),
    chainTip: live.blocks,
    bestBlockHash: cleanHash(database.best_hash) ?? live.bestBlockHash,
    indexer: {
      status: database.status,
      indexedHeight,
      targetHeight,
      progress: targetHeight > 0 ? Math.max(0, Math.min(1, (indexedHeight + 1) / (targetHeight + 1))) : 0,
      indexedBlocks: number(database.indexed_blocks) ?? 0,
      indexedTransactions: number(database.indexed_transactions) ?? 0,
      indexedAssets: number(database.indexed_assets) ?? 0,
      databaseBytes: number(database.database_bytes) ?? 0,
      latencyMs: database.latencyMs,
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
    WHERE s.id = 'ravencoin-mainnet'
    ORDER BY t.block_height DESC, t.tx_index DESC
    LIMIT $1
  `, [limit])
  return rows.map(mapTransaction)
}

export async function getIndexedBlock(pool, id) {
  const isHeight = /^\d+$/.test(String(id))
  const { rows } = await pool.query(`
    SELECT b.*, n.hash AS next_hash, (s.best_height - b.height + 1) AS confirmations
    FROM blocks b CROSS JOIN sync_state s LEFT JOIN blocks n ON n.height = b.height + 1
    WHERE s.id = 'ravencoin-mainnet' AND ${isHeight ? 'b.height = $1' : 'b.hash = $1'} LIMIT 1
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
    FROM transactions t CROSS JOIN sync_state s WHERE s.id = 'ravencoin-mainnet' AND t.txid = $1
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
      WHERE a.address = $1 AND o.spent_by_txid IS NULL ORDER BY t.block_height DESC LIMIT 100
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
    const { rows } = await pool.query('SELECT EXISTS(SELECT 1 FROM blocks WHERE hash = $1) AS is_block', [query])
    return rows[0].is_block ? { type: 'block', path: `/block/${query}` } : { type: 'transaction', path: `/tx/${query}` }
  }
  if (/^[Rr][1-9A-HJ-NP-Za-km-z]{24,35}$/.test(query)) return { type: 'address', path: `/address/${query}` }
  if (/^[A-Za-z0-9._#$!/~^-]{1,32}$/.test(query)) return { type: 'asset', path: `/asset/${encodeURIComponent(query.toUpperCase())}` }
  throw Object.assign(new Error('That search format is not recognized.'), { status: 400, code: -8 })
}
