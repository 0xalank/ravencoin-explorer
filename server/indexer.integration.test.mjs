import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { migrate } from './db.mjs'
import { rollbackTo } from './indexer.mjs'
import { aggregateBlockRange, stageRawBlockBatch } from './pipeline.mjs'
import { getIndexedAddress, getIndexedAddresses, getIndexedBlock, getIndexedNetworkStats, getIndexedTransaction } from './repository.mjs'

const connectionString = process.env.TEST_DATABASE_URL

test('indexes balances, spends, assets and reverses a reorg transactionally', { skip: !connectionString }, async (context) => {
  const pool = new pg.Pool({ connectionString })
  context.after(async () => {
    await pool.query(`
      TRUNCATE asset_transfers, asset_sync_queue, assets, address_balances, address_activity, address_transactions,
        tx_inputs, output_addresses, tx_outputs, transactions, blocks RESTART IDENTITY CASCADE;
      UPDATE sync_state SET best_height = -1, best_hash = NULL, raw_height = -1, raw_hash = NULL,
        status = 'idle', target_height = NULL, last_error = NULL;
    `)
    await pool.end()
  })
  process.env.DATABASE_URL = connectionString
  await migrate(pool)
  await pool.query(`
    TRUNCATE asset_transfers, asset_sync_queue, assets, address_balances, address_activity, address_transactions,
      tx_inputs, output_addresses, tx_outputs, transactions, blocks RESTART IDENTITY CASCADE;
    UPDATE sync_state SET best_height = -1, best_hash = NULL, raw_height = -1, raw_hash = NULL,
      status = 'idle', target_height = NULL;
  `)

  const addressA = 'R111111111111111111111111111111111'
  const addressB = 'R222222222222222222222222222222222'
  const genesisHash = 'a'.repeat(64)
  const nextHash = 'b'.repeat(64)
  const genesisTx = '1'.repeat(64)
  const nextTx = '2'.repeat(64)

  const genesis = {
    height: 0, hash: genesisHash, time: 1_700_000_000, size: 300, difficulty: 1, version: 1,
    merkleroot: 'c'.repeat(64), nonce: 1, bits: '1d00ffff', confirmations: 2,
    tx: [{
      txid: genesisTx, size: 200, version: 1, locktime: 0,
      vin: [{ coinbase: '00', sequence: 4_294_967_295 }],
      vout: [
        { n: 0, value: 50, scriptPubKey: { type: 'pubkeyhash', hex: '00', addresses: [addressA] } },
        { n: 1, value: 0, scriptPubKey: { type: 'new_asset', hex: '01', addresses: [addressA], asset: { name: 'TEST_ASSET', amount: 1000, units: 0, reissuable: true } } },
      ],
    }],
  }
  const next = {
    height: 1, hash: nextHash, previousblockhash: genesisHash, time: 1_700_000_060, size: 400, difficulty: 1, version: 1,
    merkleroot: 'd'.repeat(64), nonce: 2, bits: '1d00ffff', confirmations: 1,
    tx: [{
      txid: nextTx, size: 250, version: 1, locktime: 0,
      vin: [
        { txid: genesisTx, vout: 0, sequence: 4_294_967_294 },
        { txid: genesisTx, vout: 1, sequence: 4_294_967_294 },
      ],
      vout: [
        { n: 0, value: 40, scriptPubKey: { type: 'pubkeyhash', hex: '02', addresses: [addressB] } },
        { n: 1, value: 9.9, scriptPubKey: { type: 'pubkeyhash', hex: '03', addresses: [addressA] } },
        { n: 2, value: 0, scriptPubKey: { type: 'transfer_asset', hex: '04', addresses: [addressB], asset: { name: 'TEST_ASSET', amount: 1000 } } },
      ],
    }],
  }

  await stageRawBlockBatch(pool, [genesis], null)
  let checkpoint = (await pool.query('SELECT best_height, raw_height FROM sync_state WHERE id = $1', ['ravencoin-mainnet'])).rows[0]
  assert.equal(checkpoint.best_height, -1)
  assert.equal(checkpoint.raw_height, 0)
  await aggregateBlockRange(pool, 0, 0)
  await stageRawBlockBatch(pool, [next], genesisHash)
  checkpoint = (await pool.query('SELECT best_height, raw_height FROM sync_state WHERE id = $1', ['ravencoin-mainnet'])).rows[0]
  assert.equal(checkpoint.best_height, 0)
  assert.equal(checkpoint.raw_height, 1)
  await aggregateBlockRange(pool, 1, 1)

  const balances = (await pool.query('SELECT address, asset_name, balance FROM address_balances ORDER BY address, asset_name')).rows
  assert.deepEqual(balances.map((row) => [row.address, row.asset_name, row.balance]), [
    [addressA, 'RVN', '9.90000000'], [addressA, 'TEST_ASSET', '0.00000000'],
    [addressB, 'RVN', '40.00000000'], [addressB, 'TEST_ASSET', '1000.00000000'],
  ])
  assert.equal((await pool.query('SELECT fee_rvn FROM transactions WHERE txid = $1', [nextTx])).rows[0].fee_rvn, '0.10000000')
  assert.equal((await pool.query('SELECT count(*) AS count FROM asset_transfers')).rows[0].count, 2)
  assert.equal((await pool.query('SELECT spent_by_txid FROM tx_outputs WHERE txid = $1 AND vout_index = 0', [genesisTx])).rows[0].spent_by_txid.trim(), nextTx)

  const addressView = await getIndexedAddress(pool, addressB)
  assert.equal(addressView.balance, 40)
  assert.equal(addressView.balances.find((item) => item.assetName === 'TEST_ASSET').balance, 1000)
  assert.equal(addressView.transactions[0].txid, nextTx)
  const transactionView = await getIndexedTransaction(pool, nextTx)
  assert.equal(transactionView.fee, 0.1)
  assert.equal(transactionView.vin[0].address, addressA)
  assert.equal(transactionView.vout.length, 3)
  const blockView = await getIndexedBlock(pool, 1)
  assert.equal(blockView.hash, nextHash)
  assert.equal(blockView.transactions.length, 1)
  const rankings = await getIndexedAddresses(pool, 10, 0)
  assert.equal(rankings.total, 2)
  assert.equal(rankings.items[0].address, addressB)
  assert.equal(rankings.items[0].balance, 40)
  assert.equal(rankings.items[1].address, addressA)
  const networkStats = await getIndexedNetworkStats(pool)
  assert.equal(networkStats.windowBlocks, 2)
  assert.equal(networkStats.windowTransactions, 2)
  assert.equal(networkStats.totalFees, .1)
  assert.equal(networkStats.circulatingSupply, 5_000)

  const fakeRpc = { batch: async () => [], call: async () => ({}) }
  await rollbackTo(pool, fakeRpc, 0)
  const afterRollback = (await pool.query('SELECT address, asset_name, balance FROM address_balances ORDER BY address, asset_name')).rows
  assert.deepEqual(afterRollback.map((row) => [row.address, row.asset_name, row.balance]), [
    [addressA, 'RVN', '50.00000000'], [addressA, 'TEST_ASSET', '1000.00000000'],
  ])
  assert.equal((await pool.query('SELECT spent_by_txid FROM tx_outputs WHERE txid = $1 AND vout_index = 0', [genesisTx])).rows[0].spent_by_txid, null)
  assert.equal((await pool.query('SELECT best_height FROM sync_state WHERE id = $1', ['ravencoin-mainnet'])).rows[0].best_height, 0)
  assert.equal((await pool.query('SELECT raw_height FROM sync_state WHERE id = $1', ['ravencoin-mainnet'])).rows[0].raw_height, 0)

})
