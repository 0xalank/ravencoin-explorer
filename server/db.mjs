import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const { Pool, types } = pg
types.setTypeParser(20, (value) => Number(value))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let sharedPool

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL)
}

export function getPool(options = {}) {
  if (options.pool) return options.pool
  if (!sharedPool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for indexed mode.')
    sharedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_SIZE) || 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS) || 10_000,
      application_name: process.env.SERVICE_NAME ?? 'ravencoin-explorer',
    })
    sharedPool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message))
  }
  return sharedPool
}

export async function migrate(pool = getPool()) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [1_884_202_018])
    const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8')
    await client.query(schema)
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [1_884_202_018]).catch(() => {})
    client.release()
  }
}

export async function databaseHealth(pool = getPool()) {
  const started = performance.now()
  const { rows } = await pool.query(`
    SELECT s.*, pg_database_size(current_database()) AS database_bytes,
      GREATEST(s.best_height + 1, 0) AS indexed_blocks,
      GREATEST(s.raw_height + 1, 0) AS staged_blocks,
      (SELECT count(*) FROM transactions WHERE block_height <= s.best_height) AS indexed_transactions,
      (SELECT count(*) FROM transactions) AS staged_transactions,
      (SELECT count(*) FROM assets) AS indexed_assets
    FROM sync_state s WHERE s.id = 'ravencoin-mainnet'
  `)
  return { ...rows[0], latencyMs: Math.round(performance.now() - started) }
}

export async function closePool() {
  if (sharedPool) await sharedPool.end()
  sharedPool = undefined
}
