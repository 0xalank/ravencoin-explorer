import test from 'node:test'
import assert from 'node:assert/strict'
import { assessIndexerHealth, migrate } from './db.mjs'

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
      if (sql.includes('to_regclass')) return { rows: [{ relation: 'schema_migrations' }] }
      if (sql.includes('max(version)')) return { rows: [{ version: 2 }] }
      return { rows: [] }
    },
    release() { released = true },
  }
  await migrate({ async connect() { return client } })
  assert.equal(queries.some((sql) => sql.includes('CREATE TABLE')), false)
  assert.equal(queries.at(0).includes('pg_advisory_lock'), true)
  assert.equal(queries.at(-1).includes('pg_advisory_unlock'), true)
  assert.equal(released, true)
})

test('migration failures still unlock and release the migration client', async () => {
  const rootError = new Error('version lookup failed')
  const queries = []
  let released = false
  const client = {
    async query(sql) {
      queries.push(sql)
      if (sql.includes('to_regclass')) throw rootError
      return { rows: [] }
    },
    release() { released = true },
  }
  await assert.rejects(migrate({ async connect() { return client } }), (error) => error === rootError)
  assert.equal(queries.at(-1).includes('pg_advisory_unlock'), true)
  assert.equal(released, true)
})
