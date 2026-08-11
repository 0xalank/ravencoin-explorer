import test from 'node:test'
import assert from 'node:assert/strict'
import { RavencoinIndexer, findCommonAncestor, withIndexerLock } from './indexer.mjs'

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
