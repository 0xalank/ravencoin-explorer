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
const LATEST_SCHEMA_VERSION = 5

// These indexes back the referencing side of high-cardinality foreign keys.
// Build them concurrently on an existing v4 database so an upgrade does not
// block explorer reads while PostgreSQL scans hundreds of millions of rows.
const ONLINE_SCHEMA_MIGRATIONS = [{
  fromVersion: 4,
  version: 5,
  indexes: [
    {
      name: 'address_transactions_txid_idx',
      create: 'CREATE INDEX CONCURRENTLY address_transactions_txid_idx ON public.address_transactions (txid)',
      definitionFragments: ['ON public.address_transactions USING btree (txid)'],
    },
    {
      name: 'address_activity_txid_idx',
      create: 'CREATE INDEX CONCURRENTLY address_activity_txid_idx ON public.address_activity (txid)',
      definitionFragments: ['ON public.address_activity USING btree (txid)'],
    },
    {
      name: 'tx_outputs_spent_by_txid_idx',
      create: 'CREATE INDEX CONCURRENTLY tx_outputs_spent_by_txid_idx ON public.tx_outputs (spent_by_txid) WHERE spent_by_txid IS NOT NULL',
      definitionFragments: ['ON public.tx_outputs USING btree (spent_by_txid)', 'WHERE (spent_by_txid IS NOT NULL)'],
    },
  ],
}]

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

async function ensureOnlineIndex(client, index) {
  const readIndex = async () => {
    const { rows } = await client.query(`
      SELECT i.indisready, i.indisvalid, i.indislive,
        pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE n.nspname = 'public' AND c.relname = $1
    `, [index.name])
    return rows[0]
  }

  let existing = await readIndex()
  if (existing?.indisready && existing?.indisvalid && existing?.indislive) {
    if (!index.definitionFragments.every((fragment) => existing.definition.includes(fragment))) {
      throw new Error(`Existing index ${index.name} does not match the required definition.`)
    }
    return
  }
  // A failed CREATE INDEX CONCURRENTLY leaves an invalid same-name relation.
  // IF NOT EXISTS would silently accept it, so remove only that known remnant
  // before retrying the deterministic definition.
  if (existing) await client.query(`DROP INDEX CONCURRENTLY public.${index.name}`)
  await client.query(index.create)
  existing = await readIndex()
  if (!existing?.indisready || !existing?.indisvalid || !existing?.indislive) {
    throw new Error(`Concurrent index build did not produce a valid ${index.name}.`)
  }
}

export async function migrate(pool = getPool()) {
  const client = await pool.connect()
  let originalStatementTimeout
  let cleanupError
  try {
    const { rows: timeoutRows } = await client.query("SELECT current_setting('statement_timeout') AS value")
    originalStatementTimeout = timeoutRows[0]?.value
    // Existing explorer databases have hundreds of millions of rows. Let the
    // online build finish and make other service starters wait on the advisory
    // lock instead of churning on their normal short request timeout.
    await client.query("SELECT set_config('statement_timeout', '0', false)")
    await client.query('SELECT pg_advisory_lock($1)', [1_884_202_018])
    const { rows: relationRows } = await client.query("SELECT to_regclass('public.schema_migrations') AS relation")
    if (relationRows[0]?.relation) {
      const { rows: versionRows } = await client.query('SELECT COALESCE(max(version), 0) AS version FROM schema_migrations')
      let version = Number(versionRows[0]?.version)
      if (version >= LATEST_SCHEMA_VERSION) return
      for (const migration of ONLINE_SCHEMA_MIGRATIONS) {
        if (version !== migration.fromVersion) continue
        for (const index of migration.indexes) await ensureOnlineIndex(client, index)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [migration.version])
        version = migration.version
      }
      if (version >= LATEST_SCHEMA_VERSION) return
    }
    const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8')
    await client.query(schema)
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [1_884_202_018]) }
    catch (error) { cleanupError = error }
    if (originalStatementTimeout != null) {
      try { await client.query("SELECT set_config('statement_timeout', $1, false)", [originalStatementTimeout]) }
      catch (error) { cleanupError ??= error }
    }
    // pg clients accept an error here to destroy the connection instead of
    // returning a session with statement_timeout=0 or a leaked advisory lock.
    client.release(cleanupError)
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
