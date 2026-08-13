import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from './index.mjs'
import {
  createReversalDataService,
  encodeCsvCell,
  isValidRavencoinAddress,
  parseCsv,
  protectSpreadsheetCell,
} from './reversal-data.mjs'

const TX_A = 'a'.repeat(64)
const TX_B = 'b'.repeat(64)
const TX_C = 'c'.repeat(64)
const PREV_D = 'd'.repeat(64)
const PREV_E = 'e'.repeat(64)
const PREV_F = 'f'.repeat(64)
const TX_SPEND = '1'.repeat(64)
const TX_OTHER_SPEND = '2'.repeat(64)
const R_DEST = 'RBMHJtukwisut1iq3nYrqMLbRu6Md8FCUV'
const R_SOURCE = 'RSDqh7wURdFYanFFm5n7khARKQbdRgcRhV'
const R_SECOND_SOURCE = 'RF9J4y68AcCdzn4Qd2T4ffPTsTUteMZViT'
const R_OTHER = 'RJXFHNvEHAipwFv8gP8sXJtHGrZSiMKqhi'
const R_OTHER_SOURCE = 'RUadbuVNP74NYyV2vjJGDJrrUmBZg8pVUC'
const R_FORK_ONLY = 'RGTiYsdnxoVemyvbBEKc1WmuadE4d5KUQp'
const R_COLD = 'RVvXrXMAFmS8d63QrxCUZszUiwBYbwVtJp'
const R_CHANGE = 'RBXPXyFLYps24oS5o2yQRFXp2KzpASNtcS'
const R_VAULT = 'RFKjurWgyryfff7ePHjRmnMwhzo7E5zexP'

async function createFixture({ summaryOverride, outputsOverride, spendsOverride } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rvn-reversals-'))
  const summary = summaryOverride ?? [
    'txid,exploit_chain_height,replay_status,not_replayable_reason,confirmed_height,out_value_rvn,n_in,n_out,from_forged_block,asset,output_addresses',
    `${TX_A},4487895,CONFIRMED,,4491549,4.00000000,2,2,False,,${R_DEST}`,
    `${TX_B},4487896,CONFIRMED,,4491550,7.50000000,1,1,False,,${R_OTHER}`,
    `${TX_C},4487897,NOT_REPLAYABLE,depends-on-unreplayable-parent,,9.00000000,1,2,True,,${R_DEST}|${R_FORK_ONLY}`,
    '',
  ].join('\r\n')
  const inputs = [
    'txid,vin_index,prev_txid,prev_vout,input_address,value_rvn,asset_name,asset_amount',
    `${TX_A},0,${PREV_D},1,${R_SOURCE},5.00000000,,`,
    `${TX_A},1,${PREV_E},0,${R_SECOND_SOURCE},1.00000000,,`,
    `${TX_B},0,${PREV_F},3,${R_OTHER_SOURCE},8.00000000,,`,
    '',
  ].join('\r\n')
  const outputs = outputsOverride ?? [
    'txid,vout_index,output_address,value_rvn,script_type,asset_name,asset_amount,asset_type',
    `${TX_A},0,${R_DEST},1.25000000,pubkeyhash,,,`,
    `${TX_A},1,${R_DEST},2.75000000,pubkeyhash,,,`,
    `${TX_B},0,${R_OTHER},7.50000000,pubkeyhash,,,`,
    '',
  ].join('\r\n')
  const spends = spendsOverride ?? [
    'origin_txid,origin_vout_index,origin_output_address,origin_value_rvn,spent_by_txid,spent_by_vin,spent_height,spent_vout_index,spent_output_address,spent_value_rvn,spent_script_type',
    `${TX_A},0,${R_DEST},1.25000000,${TX_SPEND},0,4491600,0,${R_COLD},3.50000000,pubkeyhash`,
    `${TX_A},0,${R_DEST},1.25000000,${TX_SPEND},0,4491600,1,${R_CHANGE},0.40000000,pubkeyhash`,
    `${TX_A},1,${R_DEST},2.75000000,${TX_SPEND},1,4491600,0,${R_COLD},3.50000000,pubkeyhash`,
    `${TX_A},1,${R_DEST},2.75000000,${TX_SPEND},1,4491600,1,${R_CHANGE},0.40000000,pubkeyhash`,
    `${TX_B},0,${R_OTHER},7.50000000,${TX_OTHER_SPEND},0,4491601,0,${R_VAULT},7.49000000,pubkeyhash`,
    '',
  ].join('\r\n')
  await Promise.all([
    fs.writeFile(path.join(directory, 'rvn-reversed-transactions.csv'), summary),
    fs.writeFile(path.join(directory, 'rvn-reversed-transactions-inputs.csv'), inputs),
    fs.writeFile(path.join(directory, 'rvn-reversed-transactions-outputs.csv'), outputs),
    fs.writeFile(path.join(directory, 'rvn-reversed-transactions-spends.csv'), spends),
    fs.writeFile(path.join(directory, 'rvn-reversed-transactions.meta.json'), JSON.stringify({ version: 'fixture-v1' })),
  ])
  return directory
}

test('CSV parser handles CRLF, escaped quotes, commas, and quoted newlines', () => {
  const parsed = parseCsv('one,two\r\n1,"a,b"\r\n2,"say ""hi""\nagain"\r\n')
  assert.deepEqual(parsed, [
    { one: '1', two: 'a,b' },
    { one: '2', two: 'say "hi"\nagain' },
  ])
})

test('Ravencoin address validation checks Base58Check and mainnet versions', () => {
  assert.equal(isValidRavencoinAddress(R_SOURCE), true)
  assert.equal(isValidRavencoinAddress(R_DEST), true)
  assert.equal(isValidRavencoinAddress(`R${R_DEST.slice(1, -1)}1`), false)
  assert.equal(isValidRavencoinAddress('RSource'), false)
})

test('reconciliation search applies exact canonical address-pair filters', async (context) => {
  const directory = await createFixture()
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const service = createReversalDataService({ dataDir: directory })

  const result = await service.search({ from: R_SOURCE, to: R_DEST })
  assert.equal(result.total, 1)
  assert.equal(result.items[0].txid, TX_A)
  assert.equal(result.items[0].evidenceCoverage, 'canonical-exact')
  assert.deepEqual(result.items[0].inputAddresses, [R_SOURCE, R_SECOND_SOURCE])
  assert.deepEqual(result.items[0].exactOutputAddresses, [R_DEST])
  assert.equal(result.items[0].matchedOutputs.length, 2)
  assert.equal(result.items[0].matchedOutputRvn, '4.00000000')
  assert.match(result.coverage.addressPair, /does not assign ownership/i)
  assert.equal(result.dataset.version, 'fixture-v1')
  assert.equal(result.dataset.transactionCount, 3)
  assert.equal(result.dataset.statusCounts.CONFIRMED, 2)
})

test('destination filters label fork-only summary matches as candidates without exact amounts', async (context) => {
  const directory = await createFixture()
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const service = createReversalDataService({ dataDir: directory })

  const result = await service.search({ to: R_DEST })
  assert.equal(result.total, 2)
  const canonical = result.items.find((item) => item.txid === TX_A)
  const forkOnly = result.items.find((item) => item.txid === TX_C)
  assert.equal(canonical.matchedOutputRvn, '4.00000000')
  assert.equal(forkOnly.evidenceCoverage, 'fork-summary-only')
  assert.equal(forkOnly.inputAddresses, null)
  assert.equal(forkOnly.outputs, null)
  assert.equal(forkOnly.matchedOutputs, null)
  assert.equal(forkOnly.matchedOutputRvn, null)

  const sourceSearch = await service.search({ from: R_FORK_ONLY })
  assert.equal(sourceSearch.total, 0)
})

test('transaction, status, reason, and pagination filters are exact', async (context) => {
  const directory = await createFixture()
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const service = createReversalDataService({ dataDir: directory })

  assert.equal((await service.search({ q: TX_B })).items[0].txid, TX_B)
  assert.equal((await service.search({ txid: TX_C })).items[0].txid, TX_C)
  assert.equal((await service.search({ status: 'confirmed' })).total, 2)
  assert.equal((await service.search({ reason: 'depends-on-unreplayable-parent' })).total, 1)
  const page = await service.search({ limit: 1, offset: 1 })
  assert.equal(page.items.length, 1)
  assert.equal(page.total, 3)
  assert.equal(page.hasMore, true)
  await assert.rejects(() => service.search({ q: TX_A.slice(0, 12) }), (error) => error.status === 400 && error.code === 'INVALID_FILTER')
})

test('one-hop onward filtering preserves paths but sums each destination child output once', async (context) => {
  const directory = await createFixture()
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const service = createReversalDataService({ dataDir: directory })

  const result = await service.search({ onward: R_COLD })
  assert.equal(result.total, 1)
  assert.equal(result.filters.onward, R_COLD)
  assert.equal(result.items[0].txid, TX_A)
  assert.equal(result.items[0].onwardSpends.length, 2, 'both affected origin outputs retain their linkage')
  assert.deepEqual(result.items[0].onwardSpends.map((spend) => spend.originVoutIndex), [0, 1])
  assert.equal(result.items[0].matchedOnwardOutputRvn, '3.50000000', 'the shared child vout is not double counted')
  assert.match(result.coverage.onward, /does not attribute/i)

  const combined = await service.search({ from: R_SOURCE, to: R_DEST, onward: R_COLD })
  assert.equal(combined.total, 1)
  assert.equal((await service.search({ onward: R_FORK_ONLY })).total, 0)

  const unfiltered = await service.search({ q: TX_A })
  assert.equal(unfiltered.items[0].onwardSpends.length, 4)
  assert.equal(unfiltered.items[0].matchedOnwardOutputRvn, null)
  const forkOnly = await service.search({ q: TX_C })
  assert.equal(forkOnly.items[0].onwardSpends, null)
})

test('combined destination and next-hop filters require the same origin output path', async (context) => {
  const summary = [
    'txid,exploit_chain_height,replay_status,not_replayable_reason,confirmed_height,out_value_rvn,n_in,n_out,from_forged_block,asset,output_addresses',
    `${TX_A},4487895,CONFIRMED,,4491549,4.00000000,2,2,False,,${R_DEST}|${R_CHANGE}`,
    `${TX_B},4487896,CONFIRMED,,4491550,7.50000000,1,1,False,,${R_OTHER}`,
    `${TX_C},4487897,NOT_REPLAYABLE,depends-on-unreplayable-parent,,9.00000000,1,2,True,,${R_DEST}|${R_FORK_ONLY}`,
    '',
  ].join('\r\n')
  const outputs = [
    'txid,vout_index,output_address,value_rvn,script_type,asset_name,asset_amount,asset_type',
    `${TX_A},0,${R_DEST},1.25000000,pubkeyhash,,,`,
    `${TX_A},1,${R_CHANGE},2.75000000,pubkeyhash,,,`,
    `${TX_B},0,${R_OTHER},7.50000000,pubkeyhash,,,`,
    '',
  ].join('\r\n')
  const spends = [
    'origin_txid,origin_vout_index,origin_output_address,origin_value_rvn,spent_by_txid,spent_by_vin,spent_height,spent_vout_index,spent_output_address,spent_value_rvn,spent_script_type',
    `${TX_A},0,${R_DEST},1.25000000,${TX_SPEND},0,4491600,0,${R_COLD},1.24000000,pubkeyhash`,
    `${TX_A},1,${R_CHANGE},2.75000000,${TX_OTHER_SPEND},0,4491601,0,${R_VAULT},2.74000000,pubkeyhash`,
    '',
  ].join('\r\n')
  const directory = await createFixture({ summaryOverride: summary, outputsOverride: outputs, spendsOverride: spends })
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const service = createReversalDataService({ dataDir: directory })

  assert.equal((await service.search({ to: R_DEST, onward: R_VAULT })).total, 0)
  const exactPath = await service.search({ to: R_CHANGE, onward: R_VAULT })
  assert.equal(exactPath.total, 1)
  assert.equal(exactPath.items[0].onwardSpends.length, 1)
  assert.equal(exactPath.items[0].onwardSpends[0].originOutputAddress, R_CHANGE)
  assert.equal(exactPath.items[0].matchedOnwardOutputRvn, '2.74000000')
})

test('one-hop loader rejects inconsistent or invalid origin spend evidence', async (context) => {
  const inconsistent = [
    'origin_txid,origin_vout_index,origin_output_address,origin_value_rvn,spent_by_txid,spent_by_vin,spent_height,spent_vout_index,spent_output_address,spent_value_rvn,spent_script_type',
    `${TX_A},0,${R_DEST},1.25000000,${TX_SPEND},0,4491600,0,${R_COLD},3.50000000,pubkeyhash`,
    `${TX_A},0,${R_DEST},1.25000000,${TX_SPEND},0,4491601,1,${R_CHANGE},0.40000000,pubkeyhash`,
    '',
  ].join('\r\n')
  const directory = await createFixture({ spendsOverride: inconsistent })
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  await assert.rejects(
    () => createReversalDataService({ dataDir: directory }).search({}),
    /inconsistent spender data/,
  )

  const badOrigin = [
    'origin_txid,origin_vout_index,origin_output_address,origin_value_rvn,spent_by_txid,spent_by_vin,spent_height,spent_vout_index,spent_output_address,spent_value_rvn,spent_script_type',
    `${TX_A},9,${R_DEST},1.25000000,${TX_SPEND},0,4491600,0,${R_COLD},3.50000000,pubkeyhash`,
    '',
  ].join('\r\n')
  const badOriginDirectory = await createFixture({ spendsOverride: badOrigin })
  context.after(() => fs.rm(badOriginDirectory, { recursive: true, force: true }))
  await assert.rejects(
    () => createReversalDataService({ dataDir: badOriginDirectory }).search({}),
    /origin does not match normalized output/,
  )

  const negativeAmount = badOrigin.replace(`,9,${R_DEST},1.25000000,`, `,0,${R_DEST},-1.25000000,`)
  const negativeDirectory = await createFixture({ spendsOverride: negativeAmount })
  context.after(() => fs.rm(negativeDirectory, { recursive: true, force: true }))
  await assert.rejects(
    () => createReversalDataService({ dataDir: negativeDirectory }).search({}),
    /Invalid origin_value_rvn/,
  )
})

test('loader rejects companion bytes that disagree with a published manifest digest', async (context) => {
  const directory = await createFixture()
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.writeFile(path.join(directory, 'rvn-reversed-transactions.meta.json'), JSON.stringify({
    files: { canonicalOutputs: { sha256: '0'.repeat(64) } },
  }))
  await assert.rejects(
    () => createReversalDataService({ dataDir: directory }).search({}),
    /published SHA-256 digest/,
  )
})

test('filtered CSV includes all matches and protects spreadsheet formulas', async (context) => {
  const directory = await createFixture()
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const service = createReversalDataService({ dataDir: directory })

  const download = await service.download({ to: R_DEST, limit: 1 })
  assert.equal(download.count, 2, 'download ignores pagination and includes all filter matches')
  assert.match(download.body, /matching_vouts,matched_output_rvn,onward_address,onward_paths,matched_onward_output_rvn,evidence_coverage/)
  assert.match(download.body, new RegExp(`0:${R_DEST}:1\\.25000000\\|1:${R_DEST}:2\\.75000000,4\\.00000000`))
  assert.match(download.body, new RegExp(`${TX_C}.*fork-summary-only`))
  assert.equal(protectSpreadsheetCell('=2+2'), "'=2+2")
  assert.equal(protectSpreadsheetCell('@SUM(A1:A2)'), "'@SUM(A1:A2)")
  assert.equal(encodeCsvCell('=2+2,unsafe'), '"\'=2+2,unsafe"')

  const onward = await service.download({ onward: R_COLD })
  assert.equal(onward.count, 1)
  assert.match(onward.body, new RegExp(`${R_COLD},${TX_A}:0>${R_DEST}>1\\.25000000>${TX_SPEND}:0@4491600>0:${R_COLD}:3\\.50000000`))
  assert.match(onward.body, /,3\.50000000,canonical-exact/)
})

function routeHandler(app, routePath) {
  const layer = app.router.stack.find((candidate) => candidate.route?.path === routePath)
  assert.ok(layer, `route ${routePath} is registered`)
  return layer.route.stack[0].handle
}

function mockResponse() {
  return {
    headers: {},
    body: null,
    set(name, value) {
      if (typeof name === 'object') Object.assign(this.headers, name)
      else this.headers[name] = value
      return this
    },
    json(value) { this.body = value; return this },
    send(value) { this.body = value; return this },
  }
}

test('Express reconciliation routes return the standard envelope and downloadable CSV', async (context) => {
  const directory = await createFixture()
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  const app = createApp({ useDatabase: false, demoMode: 'true', reversalDataDir: directory })
  const jsonHandler = routeHandler(app, '/api/reversals')
  const csvHandler = routeHandler(app, '/api/reversals.csv')

  const response = mockResponse()
  await jsonHandler({ query: { from: R_SOURCE, to: R_DEST, onward: R_COLD } }, response, assert.fail)
  const payload = response.body
  assert.equal(payload.meta.source, 'incident-dataset')
  assert.equal(payload.meta.datasetSha256, payload.data.dataset.sha256)
  assert.equal(payload.data.total, 1)
  assert.equal(payload.data.items[0].matchedOutputRvn, '4.00000000')
  assert.equal(payload.data.items[0].matchedOnwardOutputRvn, '3.50000000')

  const csvResponse = mockResponse()
  await csvHandler({ query: { to: R_DEST } }, csvResponse, assert.fail)
  assert.match(csvResponse.headers['Content-Type'], /^text\/csv/)
  assert.match(csvResponse.headers['Content-Disposition'], /attachment/)
  assert.equal(csvResponse.headers['X-Result-Count'], '2')
  assert.ok(csvResponse.headers['X-Dataset-SHA256'])

  let routedError
  await jsonHandler({ query: { q: 'abc' } }, mockResponse(), (error) => { routedError = error })
  assert.equal(routedError.status, 400)
  assert.equal(routedError.code, 'INVALID_FILTER')
})
