import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkJsonRows } from './pipeline.mjs'

test('chunks JSON transport without splitting or dropping raw rows', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ index, value: 'x'.repeat(20 + index) }))
  const limit = 100
  const chunks = [...chunkJsonRows(rows, limit)]

  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= limit))
  assert.deepEqual(chunks.flatMap((chunk) => JSON.parse(chunk)), rows)
})

test('rejects a single row larger than the configured JSON transport chunk', () => {
  assert.throws(
    () => [...chunkJsonRows([{ value: 'x'.repeat(100) }], 50)],
    /single raw index row exceeds INDEXER_JSON_CHUNK_BYTES/,
  )
})
