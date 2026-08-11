import test from 'node:test'
import assert from 'node:assert/strict'
import { mintedSupplyAtHeight } from './repository.mjs'

test('calculates Ravencoin halving supply from indexed height', () => {
  assert.equal(mintedSupplyAtHeight(0), 0)
  assert.equal(mintedSupplyAtHeight(1), 5_000)
  assert.equal(mintedSupplyAtHeight(2_100_000), 10_500_000_000)
  assert.equal(mintedSupplyAtHeight(2_100_001), 10_500_002_500)
  assert.equal(mintedSupplyAtHeight(4_200_000), 15_750_000_000)
})
