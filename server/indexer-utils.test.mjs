import test from 'node:test'
import assert from 'node:assert/strict'
import { atomicToDecimal, BalanceAccumulator, decimalToAtomic, extractAsset, normalizeOutput } from './indexer-utils.mjs'

test('converts eight-decimal values without floating point accumulation', () => {
  assert.equal(decimalToAtomic('21000000000.12345678'), 2_100_000_000_012_345_678n)
  assert.equal(atomicToDecimal(2_100_000_000_012_345_678n), '21000000000.12345678')
})

test('recognizes native Ravencoin asset output types', () => {
  const output = normalizeOutput({ n: 1, value: 0, scriptPubKey: { type: 'new_asset', addresses: ['Rabc'], asset: { name: 'TOKEN', amount: 1000, units: 2, reissuable: true } } })
  assert.equal(output.asset.type, 'issue')
  assert.equal(output.asset.name, 'TOKEN')
  assert.deepEqual(output.addresses, ['Rabc'])
  assert.equal(extractAsset({ scriptPubKey: {} }), null)
})

test('aggregates received and sent balances atomically', () => {
  const balances = new BalanceAccumulator()
  balances.add('Rabc', 'RVN', '10.1', 'receive', 1)
  balances.add('Rabc', 'RVN', '3.00000001', 'send', 2)
  assert.deepEqual(balances.rows()[0], { address: 'Rabc', asset_name: 'RVN', balance: '7.09999999', received: '10.1', sent: '3.00000001', updated_height: 2 })
})
