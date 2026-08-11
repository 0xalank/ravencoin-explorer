import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAsset, normalizeBlock, normalizeTransaction, satsToCoin } from './rpc.mjs'

test('converts Ravencoin satoshis without precision surprises', () => {
  assert.equal(satsToCoin(123456789), 1.23456789)
})

test('normalizes a verbose block and transaction', () => {
  const block = normalizeBlock({
    height: 42,
    hash: 'abc',
    time: 100,
    size: 500,
    confirmations: 3,
    difficulty: 10,
    merkleroot: 'merkle',
    tx: [{ txid: 'tx', vout: [{ n: 0, value: 12.5, scriptPubKey: { addresses: ['Raven'], type: 'pubkeyhash' } }], vin: [] }],
  })
  assert.equal(block.txCount, 1)
  assert.equal(block.transactions[0].totalOutput, 12.5)
  assert.deepEqual(block.transactions[0].vout[0].addresses, ['Raven'])
})

test('normalizes asset metadata from listassets', () => {
  assert.deepEqual(normalizeAsset('TOKEN', { amount: 100, units: 2, reissuable: 1, has_ipfs: 1, ipfs_hash: 'Qm123' }), {
    name: 'TOKEN', amount: 100, units: 2, reissuable: true, hasIpfs: true, ipfsHash: 'Qm123', blockHeight: null, blockHash: null,
  })
})

test('calculates a transaction fee only when input values are known', () => {
  const transaction = normalizeTransaction({ txid: 'tx', vin: [{}], vout: [{ n: 0, value: 2, scriptPubKey: {} }] }, { totalInput: 2.1 })
  assert.ok(Math.abs(transaction.fee - 0.1) < 1e-10)
  assert.equal(normalizeTransaction({ txid: 'tx', vout: [] }).fee, null)
})
