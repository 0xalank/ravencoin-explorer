import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const { Pool, types } = pg
types.setTypeParser(20, (value) => Number(value))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let sharedPool
// Bump this whenever schema.sql adds a new migration version. Completed
// databases skip the idempotent DDL so API/indexer restarts cannot contend
// with live writes for table locks.
const LATEST_SCHEMA_VERSION = 4

const DEFAULT_INDEXER_STALE_SECONDS = 600

function configuredStaleSeconds(value = process.env.INDEXER_STALE_SECONDS) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(30, Math.floor(parsed)) : DEFAULT_INDEXER_STALE_SECONDS
}

function dateMilliseconds(value) {
  if (value == null) return null
  const milliseconds = new Date(value).getTime()
  return Number.isFinite(milliseconds) ? milliseconds : null
}

export function assessIndexerHealth(database, options = {}) {
  if (!database) return { stale: false, checkpointAgeSeconds: null, staleAfterSeconds: configuredStaleSeconds(options.staleSeconds) }
  const staleAfterSeconds = configuredStaleSeconds(options.staleSeconds)
  const fallbackTime = dateMilliseconds(database.started_at) ?? dateMilliseconds(database.updated_at)
  const checkpointAtMs = dateMilliseconds(database.indexed_at) ?? fallbackTime
  const nowMs = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now())
  const checkpointAgeSeconds = checkpointAtMs == null ? null : Math.max(0, Math.floor((nowMs - checkpointAtMs) / 1_000))
  const targetHeight = Number(options.targetHeight ?? database.target_height)
  const indexedHeight = Number(database.best_height)
  const behind = Number.isFinite(targetHeight) && Number.isFinite(indexedHeight) && targetHeight > indexedHeight
  const canBecomeStale = ['idle', 'syncing', 'ready'].includes(database.status)
  const indexerActive = Boolean(database.indexer_active)
  const stale = canBecomeStale && behind
    && (checkpointAgeSeconds == null || checkpointAgeSeconds > staleAfterSeconds)
  return {
    stale,
    checkpointAt: checkpointAtMs == null ? null : new Date(checkpointAtMs),
    checkpointAgeSeconds,
    staleAfterSeconds,
    indexerActive,
  }
}

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
    const { rows: relationRows } = await client.query("SELECT to_regclass('public.schema_migrations') AS relation")
    if (relationRows[0]?.relation) {
      const { rows: versionRows } = await client.query('SELECT COALESCE(max(version), 0) AS version FROM schema_migrations')
      if (Number(versionRows[0]?.version) >= LATEST_SCHEMA_VERSION) return
    }
    const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8')
    await client.query(schema)
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [1_884_202_018]).catch(() => {})
    client.release()
  }
}

async function readDatabaseState(pool, includeCounts) {
  const started = performance.now()
  const countColumns = includeCounts ? `,
      pg_database_size(current_database()) AS database_bytes,
      GREATEST(s.best_height + 1, 0) AS indexed_blocks,
      GREATEST(s.raw_height + 1, 0) AS staged_blocks,
      (SELECT COALESCE(sum(tx_count), 0) FROM blocks WHERE height <= s.best_height) AS indexed_transactions,
      (SELECT COALESCE(sum(tx_count), 0) FROM blocks) AS staged_transactions,
      (SELECT count(*) FROM assets) AS indexed_assets` : ''
  const { rows } = await pool.query(`
    SELECT s.*${countColumns},
      EXISTS (
        SELECT 1 FROM pg_stat_activity a
        WHERE a.datname = current_database() AND a.pid <> pg_backend_pid()
          AND a.application_name = $1
          AND a.state IN ('active', 'idle in transaction')
      ) AS indexer_active
    FROM sync_state s WHERE s.id = 'ravencoin-mainnet'
  `, [process.env.INDEXER_SERVICE_NAME ?? 'ravencoin-indexer'])
  const database = rows[0]
  return { ...database, ...assessIndexerHealth(database), latencyMs: Math.round(performance.now() - started) }
}

export async function databaseReadiness(pool = getPool()) {
  return readDatabaseState(pool, false)
}

export async function databaseHealth(pool = getPool()) {
  return readDatabaseState(pool, true)
}

export async function closePool() {
  if (sharedPool) await sharedPool.end()
  sharedPool = undefined
}
