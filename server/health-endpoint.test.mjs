import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHealthPayload } from './index.mjs'

function databaseHealth(indexerActive) {
  return {
    status: 'syncing', best_height: 100, raw_height: 110, target_height: 200,
    indexed_at: new Date(Date.now() - 700_000), raw_indexed_at: new Date(Date.now() - 700_000),
    updated_at: new Date(Date.now() - 700_000), started_at: new Date(Date.now() - 3_600_000),
    last_error: null, latencyMs: 2, indexer_active: indexerActive,
  }
}

test('health endpoint degrades when the indexer checkpoint is stale', async () => {
  const health = buildHealthPayload({ chain: 'main', blocks: 200 }, databaseHealth(false))
  assert.equal(health.healthy, false)
  assert.equal(health.body.status, 'degraded')
  assert.equal(health.body.database.stale, true)
  assert.ok(health.body.database.checkpointAgeSeconds >= 599)
})

test('health endpoint exposes activity without letting it mask a stale checkpoint', async () => {
  const health = buildHealthPayload({ chain: 'main', blocks: 200 }, databaseHealth(true))
  assert.equal(health.healthy, false)
  assert.equal(health.body.database.stale, true)
  assert.equal(health.body.database.active, true)
})
