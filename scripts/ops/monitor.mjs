import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg

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

function formatBytes(value) {
  let amount = Number(value)
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

async function readState(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error(`Cannot read monitor state ${filename}: ${error.message}`)
  }
}

async function writeState(filename, state) {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  await fs.rename(temporary, filename)
}

async function fetchHealth(url, timeout) {
  let response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) })
  } catch (error) {
    throw new Error(`Health endpoint unavailable: ${error.message}`)
  }
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`Health endpoint returned non-JSON HTTP ${response.status}.`)
  }
  if (!response.ok) throw Object.assign(new Error(`Health endpoint returned HTTP ${response.status} (${body.status ?? 'unknown'}).`), { health: body })
  return body
}

async function databaseMetrics(connectionString, timeout) {
  if (!connectionString) return null
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: timeout,
    statement_timeout: timeout,
    application_name: 'ravencoin-ops-monitor',
  })
  try {
    const { rows } = await pool.query(`
      SELECT s.status, s.best_height, s.raw_height, s.target_height, s.last_error,
        extract(epoch FROM now() - COALESCE(s.indexed_at, s.started_at, s.updated_at)) AS indexed_age_seconds,
        extract(epoch FROM now() - COALESCE(s.raw_indexed_at, s.started_at, s.updated_at)) AS raw_age_seconds,
        d.temp_bytes, d.stats_reset, pg_database_size(current_database()) AS database_bytes
      FROM sync_state s
      JOIN pg_stat_database d ON d.datname = current_database()
      WHERE s.id = 'ravencoin-mainnet'
    `)
    if (!rows[0]) throw new Error('sync_state row is missing.')
    return rows[0]
  } finally {
    await pool.end()
  }
}

function printHelp() {
  console.log(`Usage: pnpm ops:monitor

Cron-friendly health, checkpoint-staleness, PostgreSQL temp-I/O, and disk check.

Optional:
  MONITOR_HEALTH_URL=http://127.0.0.1:3102/api/health
  MONITOR_DISK_PATH=/
  MONITOR_MIN_DISK_FREE_BYTES=21474836480
  MONITOR_MIN_DISK_FREE_PERCENT=10
  MONITOR_STALE_SECONDS=600 (falls back to INDEXER_STALE_SECONDS)
  MONITOR_DATABASE_URL=... (falls back to DATABASE_URL)
  MONITOR_REQUIRE_DATABASE=false
  MONITOR_MAX_TEMP_BYTES_PER_INTERVAL=0 (0 disables the delta threshold)
  MONITOR_STATE_FILE=/tmp/ravencoin-explorer-monitor.json`)
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return printHelp()
  const healthUrl = process.env.MONITOR_HEALTH_URL ?? 'http://127.0.0.1:3102/api/health'
  const diskPath = process.env.MONITOR_DISK_PATH ?? '/'
  const stateFile = process.env.MONITOR_STATE_FILE ?? '/tmp/ravencoin-explorer-monitor.json'
  const timeout = integerSetting('MONITOR_TIMEOUT_MS', 10_000, 1_000, 120_000)
  const staleSeconds = integerSetting(
    'MONITOR_STALE_SECONDS',
    integerSetting('INDEXER_STALE_SECONDS', 600, 60, 86_400),
    60,
    86_400,
  )
  const minimumDiskBytes = BigInt(integerSetting('MONITOR_MIN_DISK_FREE_BYTES', 20 * 1024 ** 3, 0))
  const minimumDiskPercent = integerSetting('MONITOR_MIN_DISK_FREE_PERCENT', 10, 0, 100)
  const maximumTempDelta = BigInt(integerSetting('MONITOR_MAX_TEMP_BYTES_PER_INTERVAL', 0, 0))
  const requireDatabase = booleanSetting('MONITOR_REQUIRE_DATABASE', false)
  const connectionString = process.env.MONITOR_DATABASE_URL ?? process.env.DATABASE_URL
  const previous = await readState(stateFile)
  const now = Date.now()
  const failures = []
  const warnings = []

  let health = null
  try {
    health = await fetchHealth(healthUrl, timeout)
  } catch (error) {
    failures.push(error.message)
    health = error.health ?? null
  }
  if (health?.status && health.status !== 'ok') failures.push(`Explorer health status is ${health.status}.`)
  if (health?.database?.stale === true) failures.push('Explorer health reports a stale indexer checkpoint.')

  let database = null
  if (connectionString) {
    try {
      database = await databaseMetrics(connectionString, timeout)
    } catch (error) {
      failures.push(`PostgreSQL monitor query failed: ${error.message}`)
    }
  } else if (requireDatabase) {
    failures.push('MONITOR_REQUIRE_DATABASE is true but no MONITOR_DATABASE_URL or DATABASE_URL is configured.')
  } else {
    warnings.push('PostgreSQL metrics unavailable; relying on public health and persisted height observations.')
  }

  const indexedHeight = Number(database?.best_height ?? health?.database?.indexedHeight ?? -1)
  const rawHeight = Number(database?.raw_height ?? health?.database?.rawHeight ?? indexedHeight)
  const targetHeight = Number(database?.target_height ?? health?.database?.targetHeight ?? health?.chainHeight ?? -1)
  const behind = indexedHeight >= 0 && targetHeight >= 0 && indexedHeight < targetHeight
  let unchangedSince = Number(previous.unchangedSince ?? now)
  if (indexedHeight !== Number(previous.indexedHeight)) unchangedSince = now

  if (database) {
    const indexedAge = Number(database.indexed_age_seconds)
    if (behind && Number.isFinite(indexedAge) && indexedAge > staleSeconds) {
      failures.push(`Processed checkpoint has not advanced for ${Math.round(indexedAge)}s (limit ${staleSeconds}s).`)
    }
    if (database.status === 'error') failures.push(`Indexer database status is error${database.last_error ? `: ${database.last_error}` : '.'}`)
    if (database.last_error && database.status !== 'error') warnings.push(`Indexer retains a last_error value: ${database.last_error}`)
  } else if (behind && now - unchangedSince > staleSeconds * 1_000) {
    failures.push(`Observed processed height ${indexedHeight} unchanged for ${Math.round((now - unchangedSince) / 1_000)}s while target is ${targetHeight}.`)
  }

  const filesystem = await fs.statfs(diskPath, { bigint: true })
  const freeBytes = filesystem.bavail * filesystem.bsize
  const totalBytes = filesystem.blocks * filesystem.bsize
  const freePercent = totalBytes === 0n ? 0 : Number((freeBytes * 10_000n) / totalBytes) / 100
  if (freeBytes < minimumDiskBytes) failures.push(`Disk free space ${formatBytes(freeBytes)} is below ${formatBytes(minimumDiskBytes)}.`)
  if (freePercent < minimumDiskPercent) failures.push(`Disk free space ${freePercent.toFixed(1)}% is below ${minimumDiskPercent}%.`)

  let tempBytes = previous.tempBytes ?? null
  let statsReset = previous.statsReset ?? null
  if (database?.temp_bytes != null) {
    tempBytes = String(database.temp_bytes)
    statsReset = database.stats_reset == null ? null : new Date(database.stats_reset).toISOString()
    if (previous.tempBytes != null && previous.statsReset === statsReset) {
      const delta = BigInt(tempBytes) - BigInt(previous.tempBytes)
      if (delta >= 0n) {
        console.log(`PostgreSQL temporary I/O since previous run: ${formatBytes(delta)} (cumulative ${formatBytes(tempBytes)}).`)
        if (maximumTempDelta > 0n && delta > maximumTempDelta) {
          failures.push(`PostgreSQL temporary I/O grew by ${formatBytes(delta)}, above ${formatBytes(maximumTempDelta)} per monitor interval.`)
        }
      }
    } else {
      console.log(`PostgreSQL temporary I/O baseline: ${formatBytes(tempBytes)} cumulative.`)
    }
  }

  await writeState(stateFile, {
    checkedAt: new Date(now).toISOString(),
    indexedHeight,
    rawHeight,
    targetHeight,
    unchangedSince,
    tempBytes,
    statsReset,
  })

  console.log(`Explorer: processed ${indexedHeight}, staged ${rawHeight}, target ${targetHeight}; disk ${formatBytes(freeBytes)} free (${freePercent.toFixed(1)}%).`)
  for (const warning of warnings) console.warn(`WARN ${warning}`)
  if (failures.length) {
    for (const failure of [...new Set(failures)]) console.error(`FAIL ${failure}`)
    throw new Error(`${[...new Set(failures)].length} operational check${failures.length === 1 ? '' : 's'} failed.`)
  }
  console.log('Operational checks passed.')
}

try {
  await main()
} catch (error) {
  console.error(`Explorer monitor failed: ${error.message}`)
  process.exitCode = 1
}
