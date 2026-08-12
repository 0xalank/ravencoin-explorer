import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RavencoinIndexer, findCommonAncestor, findNextAggregationRange, isRetryableAggregationError, withIndexerLock,
} from './indexer.mjs'

function statePool(state, updates) {
  return {
    async query(sql, values = []) {
      if (sql.startsWith('SELECT * FROM sync_state')) return { rows: [{ ...state }] }
      if (sql.startsWith('UPDATE sync_state SET')) {
        updates.push({ sql, values })
        return { rows: [] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
}

test('parallel range planner fills durable gaps without overlapping completed work', () => {
  assert.deepEqual(findNextAggregationRange(100, 499, 100, [
    { firstHeight: 100, lastHeight: 199 },
    { firstHeight: 300, lastHeight: 399 },
  ]), { firstHeight: 200, lastHeight: 299 })
  assert.deepEqual(findNextAggregationRange(100, 450, 100, [
    { firstHeight: 100, lastHeight: 199 },
    { firstHeight: 200, lastHeight: 299 },
    { firstHeight: 300, lastHeight: 399 },
  ]), { firstHeight: 400, lastHeight: 450 })
  assert.equal(findNextAggregationRange(100, 399, 100, [
    { firstHeight: 100, lastHeight: 199 },
    { firstHeight: 200, lastHeight: 399 },
  ]), null)
})

test('only retries aggregation failures that a smaller range can resolve', () => {
  assert.equal(isRetryableAggregationError(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })), true)
  assert.equal(isRetryableAggregationError(Object.assign(new Error('program limit exceeded'), { code: '54000' })), true)
  assert.equal(isRetryableAggregationError(new Error('total size of jsonb array elements exceeds the maximum')), true)
  assert.equal(isRetryableAggregationError(Object.assign(new Error('canceling statement due to user request'), { code: '57014' })), false)
  assert.equal(isRetryableAggregationError(Object.assign(new Error('unique violation'), { code: '23505' })), false)
})

test('prepares batches concurrently but reduces their checkpoints in chain order', async () => {
  const rawHash = 'd'.repeat(64)
  const state = {
    best_height: -1, best_hash: null, raw_height: 3, raw_hash: rawHash,
    status: 'syncing', started_at: new Date(),
  }
  const updates = []
  const prepared = new Map()
  const reductions = []
  let activePreparations = 0
  let maxPreparations = 0
  const pool = {
    async query(sql, values = []) {
      if (sql.startsWith('SELECT * FROM sync_state')) return { rows: [{ ...state }] }
      if (sql.startsWith('UPDATE sync_state SET')) {
        updates.push({ sql, values })
        return { rows: [] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  const indexer = new RavencoinIndexer({
    pool,
    rpc: { async call(method) {
      if (method === 'getblockchaininfo') return { chain: 'main', blocks: 3 }
      if (method === 'getblockhash') return rawHash
      throw new Error(`Unexpected RPC call: ${method}`)
    } },
    aggregationBatchSize: 1,
    aggregationConcurrency: 3,
    async prepareBlocks(_pool, firstHeight, lastHeight) {
      activePreparations += 1
      maxPreparations = Math.max(maxPreparations, activePreparations)
      await new Promise((resolve) => setTimeout(resolve, firstHeight === 0 ? 35 : 5))
      prepared.set(firstHeight, lastHeight)
      activePreparations -= 1
    },
    async listPreparedRanges(_pool, firstHeight, lastHeight) {
      return [...prepared.entries()]
        .filter(([first, last]) => last >= firstHeight && first <= lastHeight)
        .map(([first, last]) => ({ firstHeight: first, lastHeight: last }))
    },
    async reduceBlocks() {
      const firstHeight = Number(state.best_height) + 1
      if (!prepared.has(firstHeight)) return null
      const lastHeight = prepared.get(firstHeight)
      prepared.delete(firstHeight)
      state.best_height = lastHeight
      reductions.push([firstHeight, lastHeight])
      return { firstHeight, lastHeight }
    },
    async drainAssets() { return false },
  })

  await indexer.syncOnce()
  assert.equal(maxPreparations, 3)
  assert.deepEqual(reductions, [[0, 0], [1, 1], [2, 2], [3, 3]])
  assert.equal(state.best_height, 3)
  assert.equal(updates.some(({ values }) => values.includes('ready')), true)
})

test('cancels and awaits sibling workers before surfacing the first pipeline error', async () => {
  const rootError = new Error('raw producer failed')
  const state = {
    best_height: -1, best_hash: null, raw_height: 0, raw_hash: 'a'.repeat(64),
    status: 'idle', started_at: null,
  }
  const updates = []
  let aggregationFinished = false
  const indexer = new RavencoinIndexer({
    pool: statePool(state, updates),
    rpc: {
      async call(method) {
        if (method === 'getblockchaininfo') return { chain: 'main', blocks: 1 }
        if (method === 'getblockhash') return state.raw_hash
        throw new Error(`Unexpected RPC call: ${method}`)
      },
    },
    async fetchBlocks() { throw rootError },
    async stageBlocks() { throw new Error('stage should not run') },
    async aggregateBlocks() {
      await new Promise((resolve) => setTimeout(resolve, 25))
      aggregationFinished = true
    },
    async drainAssets() { return false },
  })

  await assert.rejects(indexer.syncOnce(), (error) => error === rootError)
  assert.equal(aggregationFinished, true, 'syncOnce must await the surviving aggregation worker')
  assert.equal(updates.some(({ values }) => values.includes('ready')), false, 'a sibling must not report the failed cycle ready')
})

test('stop aborts sleeping cycle workers without reporting ready', async () => {
  const state = {
    best_height: -1, best_hash: null, raw_height: -1, raw_hash: null,
    status: 'idle', started_at: null,
  }
  const updates = []
  const indexer = new RavencoinIndexer({
    pool: statePool(state, updates),
    rpc: { async call() { return { chain: 'main', blocks: 1 } } },
    async fetchBlocks() {
      await new Promise((resolve) => setTimeout(resolve, 25))
      throw new Error('request cancelled while stopping')
    },
    async aggregateBlocks() {},
    async drainAssets() { return false },
  })
  const syncing = indexer.syncOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  indexer.stop()
  await syncing
  assert.equal(indexer.stopping, true)
  assert.equal(indexer.cycleController, null)
  assert.equal(updates.some(({ values }) => values.includes('ready')), false)
})

test('run does not report an intentional shutdown rejection as an indexer error', async () => {
  const updates = []
  const indexer = new RavencoinIndexer({
    pool: statePool({}, updates),
    rpc: {},
    async drainAssets() { return false },
  })
  indexer.syncOnce = async () => {
    indexer.stop()
    throw new Error('operation interrupted by shutdown')
  }
  await indexer.run()
  assert.equal(updates.length, 0)
})

test('stop during initial RPC does not clear state or start a cycle', async () => {
  const updates = []
  const indexer = new RavencoinIndexer({
    pool: statePool({}, updates),
    rpc: { async call() {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { chain: 'main', blocks: 1 }
    } },
    async drainAssets() { return false },
  })
  const syncing = indexer.syncOnce()
  await new Promise((resolve) => setTimeout(resolve, 10))
  indexer.stop()
  await syncing
  assert.equal(updates.length, 0)
})

test('singleton lock rejection releases its checked-out database client', async () => {
  let released = false
  let worked = false
  const client = {
    async query() { return { rows: [{ locked: false }] } },
    release() { released = true },
  }
  await assert.rejects(withIndexerLock({ async connect() { return client } }, async () => { worked = true }), /already holds/)
  assert.equal(worked, false)
  assert.equal(released, true)
})

test('singleton lock is unlocked and released when indexed work fails', async () => {
  const queries = []
  let released = false
  const client = {
    async query(sql) {
      queries.push(sql)
      return { rows: [{ locked: true }] }
    },
    release() { released = true },
  }
  const rootError = new Error('indexer failed')
  await assert.rejects(withIndexerLock({ async connect() { return client } }, async () => { throw rootError }), (error) => error === rootError)
  assert.equal(queries.some((sql) => sql.includes('pg_advisory_unlock')), true)
  assert.equal(released, true)
})

test('tip hash RPC failures abort safely instead of being treated as reorgs', async () => {
  const rpcError = new Error('Ravencoin RPC timed out')
  const state = {
    best_height: 100, best_hash: 'a'.repeat(64), raw_height: 100, raw_hash: 'a'.repeat(64),
    status: 'syncing', started_at: new Date(),
  }
  const updates = []
  const indexer = new RavencoinIndexer({
    pool: statePool(state, updates),
    rpc: { async call(method) {
      if (method === 'getblockchaininfo') return { chain: 'main', blocks: 200 }
      if (method === 'getblockhash') throw rpcError
      throw new Error(`Unexpected RPC call: ${method}`)
    } },
    async drainAssets() { return false },
  })
  await assert.rejects(indexer.syncOnce(), (error) => error === rpcError)
  assert.equal(updates.length, 0, 'an unavailable RPC must not mutate the checkpoint')
})

test('common-ancestor search propagates RPC failures without walking toward genesis', async () => {
  const rpcError = new Error('Ravencoin RPC disconnected')
  let databaseQueries = 0
  let rpcCalls = 0
  const client = { async query() {
    databaseQueries += 1
    return { rows: [{ hash: 'a'.repeat(64) }] }
  } }
  const rpc = { async call() {
    rpcCalls += 1
    throw rpcError
  } }
  await assert.rejects(findCommonAncestor(client, rpc, 100), (error) => error === rpcError)
  assert.equal(databaseQueries, 1)
  assert.equal(rpcCalls, 1)
})
