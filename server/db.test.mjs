import test from 'node:test'
import assert from 'node:assert/strict'
import { assessIndexerHealth, databaseHealth, databaseReadiness, migrate } from './db.mjs'

const now = new Date('2026-08-11T18:00:00.000Z')

test('marks a behind indexer stale when its checkpoints stop advancing', () => {
  const health = assessIndexerHealth({
    status: 'syncing', best_height: 100, target_height: 200,
    indexed_at: new Date('2026-08-11T17:50:00.000Z'), raw_indexed_at: null,
    indexer_active: false,
  }, { now, staleSeconds: 300 })
  assert.equal(health.stale, true)
  assert.equal(health.checkpointAgeSeconds, 600)
  assert.equal(health.staleAfterSeconds, 300)
})

test('does not let an active database session mask a stale processed checkpoint', () => {
  const health = assessIndexerHealth({
    status: 'syncing', best_height: 100, target_height: 200,
    indexed_at: new Date('2026-08-11T17:50:00.000Z'), indexer_active: true,
  }, { now, staleSeconds: 300 })
  assert.equal(health.stale, true)
  assert.equal(health.indexerActive, true)
})

test('uses the processed checkpoint and ignores caught-up services', () => {
  const stalledAggregation = assessIndexerHealth({
    status: 'syncing', best_height: 100, target_height: 200,
    indexed_at: new Date('2026-08-11T17:40:00.000Z'),
    raw_indexed_at: new Date('2026-08-11T17:59:00.000Z'), indexer_active: false,
  }, { now, staleSeconds: 300 })
  assert.equal(stalledAggregation.stale, true)
  assert.equal(stalledAggregation.checkpointAgeSeconds, 1_200)

  const caughtUp = assessIndexerHealth({
    status: 'ready', best_height: 200, target_height: 200,
    indexed_at: new Date('2026-08-11T17:00:00.000Z'), indexer_active: false,
  }, { now, staleSeconds: 300 })
  assert.equal(caughtUp.stale, false)
})

test('skips completed schema DDL during concurrent service startup', async () => {
  const queries = []
  let released = false
  const client = {
    async query(sql) {
      queries.push(sql)
      if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ value: '10s' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: 'schema_migrations' }] }
      if (sql.includes('max(version)')) return { rows: [{ version: 5 }] }
      return { rows: [] }
    },
    release(error) { assert.equal(error, undefined); released = true },
  }
  await migrate({ async connect() { return client } })
  assert.equal(queries.some((sql) => sql.includes('CREATE TABLE')), false)
  assert.equal(queries.some((sql) => sql.includes('pg_advisory_lock')), true)
  assert.equal(queries.some((sql) => sql.includes('pg_advisory_unlock')), true)
  assert.equal(queries.at(-1).includes("set_config('statement_timeout'"), true)
  assert.equal(released, true)
})

test('upgrades a v4 database with non-blocking foreign-key indexes', async () => {
  const queries = []
  let released = false
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values })
      if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ value: '2min' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: 'schema_migrations' }] }
      if (sql.includes('max(version)')) return { rows: [{ version: 4 }] }
      if (sql.includes('FROM pg_class')) {
        const name = values[0]
        const built = queries.some(({ sql: query }) => query.startsWith('CREATE INDEX CONCURRENTLY') && query.includes(name))
        if (!built) return { rows: [] }
        const definitions = {
          address_activity_txid_idx: 'CREATE INDEX address_activity_txid_idx ON public.address_activity USING btree (txid)',
          address_transactions_txid_idx: 'CREATE INDEX address_transactions_txid_idx ON public.address_transactions USING btree (txid)',
          tx_outputs_spent_by_txid_idx: 'CREATE INDEX tx_outputs_spent_by_txid_idx ON public.tx_outputs USING btree (spent_by_txid) WHERE (spent_by_txid IS NOT NULL)',
        }
        return { rows: [{ indisready: true, indisvalid: true, indislive: true, definition: definitions[name] }] }
      }
      return { rows: [] }
    },
    release(error) { assert.equal(error, undefined); released = true },
  }
  await migrate({ async connect() { return client } })
  const concurrent = queries.filter(({ sql }) => sql.startsWith('CREATE INDEX CONCURRENTLY'))
  assert.equal(concurrent.length, 3)
  assert.equal(concurrent.every(({ sql }) => !sql.includes('IF NOT EXISTS')), true)
  assert.deepEqual(queries.find(({ sql }) => sql.startsWith('INSERT INTO schema_migrations'))?.values, [5])
  assert.equal(queries.some(({ sql }) => sql.includes('CREATE TABLE')), false)
  assert.equal(queries.some(({ sql }) => sql.includes('pg_advisory_unlock')), true)
  assert.deepEqual(queries.at(-1).values, ['2min'])
  assert.equal(released, true)
})

test('rebuilds an invalid concurrent index before recording its migration', async () => {
  const queries = []
  let catalogReads = 0
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values })
      if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ value: '2min' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: 'schema_migrations' }] }
      if (sql.includes('max(version)')) return { rows: [{ version: 4 }] }
      if (sql.includes('FROM pg_class')) {
        catalogReads += 1
        if (catalogReads === 1) return { rows: [{ indisready: false, indisvalid: false, indislive: true, definition: '' }] }
        const name = values[0]
        const definitions = {
          address_activity_txid_idx: 'CREATE INDEX address_activity_txid_idx ON public.address_activity USING btree (txid)',
          address_transactions_txid_idx: 'CREATE INDEX address_transactions_txid_idx ON public.address_transactions USING btree (txid)',
          tx_outputs_spent_by_txid_idx: 'CREATE INDEX tx_outputs_spent_by_txid_idx ON public.tx_outputs USING btree (spent_by_txid) WHERE (spent_by_txid IS NOT NULL)',
        }
        return { rows: [{ indisready: true, indisvalid: true, indislive: true, definition: definitions[name] }] }
      }
      return { rows: [] }
    },
    release() {},
  }
  await migrate({ async connect() { return client } })
  const drop = queries.findIndex(({ sql }) => sql === 'DROP INDEX CONCURRENTLY public.address_transactions_txid_idx')
  const create = queries.findIndex(({ sql }) => sql.startsWith('CREATE INDEX CONCURRENTLY address_transactions_txid_idx'))
  assert.equal(drop >= 0, true)
  assert.equal(create > drop, true)
})

test('rejects a valid same-name index with the wrong definition', async () => {
  const client = {
    async query(sql) {
      if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ value: '2min' }] }
      if (sql.includes('to_regclass')) return { rows: [{ relation: 'schema_migrations' }] }
      if (sql.includes('max(version)')) return { rows: [{ version: 4 }] }
      if (sql.includes('FROM pg_class')) return { rows: [{ indisready: true, indisvalid: true, indislive: true, definition: 'CREATE INDEX address_transactions_txid_idx ON public.address_transactions USING btree (address)' }] }
      return { rows: [] }
    },
    release() {},
  }
  await assert.rejects(migrate({ async connect() { return client } }), /does not match the required definition/)
})

test('migration failures still unlock and release the migration client', async () => {
  const rootError = new Error('version lookup failed')
  const queries = []
  let released = false
  const client = {
    async query(sql) {
      queries.push(sql)
      if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ value: '10s' }] }
      if (sql.includes('to_regclass')) throw rootError
      return { rows: [] }
    },
    release() { released = true },
  }
  await assert.rejects(migrate({ async connect() { return client } }), (error) => error === rootError)
  assert.equal(queries.some((sql) => sql.includes('pg_advisory_unlock')), true)
  assert.equal(queries.at(-1).includes("set_config('statement_timeout'"), true)
  assert.equal(released, true)
})

test('database readiness avoids history-wide counts used by full status', async () => {
  const queries = []
  const pool = { async query(sql) {
    queries.push(sql)
    return { rows: [{
      status: 'syncing', best_height: 100, raw_height: 110, target_height: 200,
      indexed_at: new Date(), raw_indexed_at: new Date(), updated_at: new Date(),
      indexer_active: false,
    }] }
  } }
  const readiness = await databaseReadiness(pool)
  assert.equal(readiness.best_height, 100)
  assert.equal(readiness.stale, false)
  assert.equal(/count\s*\(/i.test(queries[0]), false)
  assert.equal(queries[0].includes('pg_database_size'), false)
  assert.equal(queries[0].includes('pg_stat_activity'), true)

  await databaseHealth(pool)
  assert.equal(queries[1].includes('sum(tx_count)'), true)
  assert.equal(queries[1].includes('count(*) FROM transactions'), false)
  assert.equal(queries[1].includes('pg_database_size'), true)
})
