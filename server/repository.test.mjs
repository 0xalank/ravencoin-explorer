import test from 'node:test'
import assert from 'node:assert/strict'
import { getIndexedNetworkStats, mintedSupplyAtHeight } from './repository.mjs'

test('calculates Ravencoin halving supply from indexed height', () => {
  assert.equal(mintedSupplyAtHeight(0), 0)
  assert.equal(mintedSupplyAtHeight(1), 5_000)
  assert.equal(mintedSupplyAtHeight(2_100_000), 10_500_000_000)
  assert.equal(mintedSupplyAtHeight(2_100_001), 10_500_002_500)
  assert.equal(mintedSupplyAtHeight(4_200_000), 15_750_000_000)
})

test('network stats bound address activity by the recent block window', async () => {
  const queries = []
  const pool = { async query(sql) { queries.push(sql); return { rows: [] } } }
  await getIndexedNetworkStats(pool)

  assert.equal(queries.length, 2)
  for (const sql of queries) {
    assert.match(sql, /recent_address_transactions AS MATERIALIZED/)
    assert.match(sql, /a\.block_height BETWEEN r\.start_height AND r\.end_height/)
  }
  assert.match(queries[0], /sum\(tx_count\).*FROM blocks WHERE height <= r\.end_height/s)
  assert.match(queries[0], /asset_name = 'RVN' AND balance > 0/)
  assert.match(queries[1], /FROM blocks b CROSS JOIN bounds x/)
})
