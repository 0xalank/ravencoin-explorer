import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SUMMARY_FILE = 'rvn-reversed-transactions.csv'
const INPUTS_FILE = 'rvn-reversed-transactions-inputs.csv'
const OUTPUTS_FILE = 'rvn-reversed-transactions-outputs.csv'
const SPENDS_FILE = 'rvn-reversed-transactions-spends.csv'
const METADATA_FILE = 'rvn-reversed-transactions.meta.json'
const SATOSHIS_PER_RVN = 100_000_000n
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const RAVENCOIN_ADDRESS_VERSIONS = new Set([60, 122])

const REQUIRED_SUMMARY_HEADERS = [
  'txid', 'exploit_chain_height', 'replay_status', 'not_replayable_reason',
  'confirmed_height', 'out_value_rvn', 'n_in', 'n_out', 'from_forged_block',
  'asset', 'output_addresses',
]
const REQUIRED_INPUT_HEADERS = [
  'txid', 'vin_index', 'prev_txid', 'prev_vout', 'input_address',
  'value_rvn', 'asset_name', 'asset_amount',
]
const REQUIRED_OUTPUT_HEADERS = [
  'txid', 'vout_index', 'output_address', 'value_rvn', 'script_type',
  'asset_name', 'asset_amount', 'asset_type',
]
const REQUIRED_SPEND_HEADERS = [
  'origin_txid', 'origin_vout_index', 'origin_output_address', 'origin_value_rvn',
  'spent_by_txid', 'spent_by_vin', 'spent_height', 'spent_vout_index',
  'spent_output_address', 'spent_value_rvn', 'spent_script_type',
]

export const REVERSAL_COVERAGE = Object.freeze({
  canonicalExact: 'Confirmed transactions use normalized canonical-chain inputs and outputs. Address matches and matched output amounts are exact for this subset.',
  forkSummaryOnly: 'Transactions absent from the canonical chain retain only the source CSV summary. Their listed output addresses are transaction-level candidates; input addresses, vout mapping, and per-address amounts are unavailable.',
  addressPair: 'A from/to result means the transaction has at least one matching input address and one matching output address. It does not assign ownership of an output to a particular input.',
  onward: 'A one-hop path proves that an affected output was consumed by the listed direct spending transaction and that transaction created the listed destination output. A multi-input consolidation does not attribute that destination output or amount one-to-one to the affected input.',
  grossValue: 'Transaction output totals are gross output sums. They may include change and may count the same economic value again in descendant transactions.',
})

export class ReversalDataError extends Error {
  constructor(message, { code = 'REVERSAL_DATA_INVALID', status = 500 } = {}) {
    super(message)
    this.name = 'ReversalDataError'
    this.code = code
    this.status = status
  }
}

/**
 * Parse a practical RFC 4180 CSV dialect, including CRLF, quoted separators,
 * doubled quotes, and quoted newlines. Blank trailing records are ignored.
 */
export function parseCsv(text, { fileName = 'CSV' } = {}) {
  const source = String(text).replace(/^\uFEFF/, '')
  const records = []
  let record = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
      continue
    }
    if (character === '"') {
      if (field.length) throw new ReversalDataError(`${fileName} has a quote inside an unquoted field.`)
      quoted = true
    } else if (character === ',') {
      record.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      record.push(field)
      field = ''
      if (record.some((value) => value !== '')) records.push(record)
      record = []
    } else field += character
  }

  if (quoted) throw new ReversalDataError(`${fileName} ends inside a quoted field.`)
  if (field !== '' || record.length) {
    record.push(field)
    if (record.some((value) => value !== '')) records.push(record)
  }
  if (!records.length) throw new ReversalDataError(`${fileName} is empty.`)

  const headers = records.shift().map((header) => header.trim())
  if (new Set(headers).size !== headers.length) throw new ReversalDataError(`${fileName} contains duplicate headers.`)
  return records.map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new ReversalDataError(`${fileName} row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}.`)
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]))
  })
}

function assertHeaders(rows, required, fileName) {
  if (!rows.length) throw new ReversalDataError(`${fileName} contains no data rows.`)
  const present = new Set(Object.keys(rows[0]))
  const missing = required.filter((header) => !present.has(header))
  if (missing.length) throw new ReversalDataError(`${fileName} is missing required columns: ${missing.join(', ')}.`)
}

function parseInteger(value, field, { nullable = false } = {}) {
  if (nullable && value === '') return null
  if (!/^\d+$/.test(value)) throw new ReversalDataError(`Invalid ${field}: ${JSON.stringify(value)}.`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new ReversalDataError(`${field} is outside the safe integer range.`)
  return parsed
}

function parseBoolean(value, field) {
  if (value === 'True' || value === 'true' || value === '1') return true
  if (value === 'False' || value === 'false' || value === '0') return false
  throw new ReversalDataError(`Invalid ${field}: ${JSON.stringify(value)}.`)
}

function assertAmount(value, field, { nullable = false } = {}) {
  if (nullable && value === '') return null
  if (!/^\d+(?:\.\d{1,8})?$/.test(value)) throw new ReversalDataError(`Invalid ${field}: ${JSON.stringify(value)}.`)
  return value
}

function decimalToSatoshis(value) {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * SATOSHIS_PER_RVN + BigInt(fraction.padEnd(8, '0'))
}

function satoshisToDecimal(value) {
  const whole = value / SATOSHIS_PER_RVN
  const fraction = String(value % SATOSHIS_PER_RVN).padStart(8, '0')
  return `${whole}.${fraction}`
}

function exactString(value, field, maximum = 128) {
  const result = String(value ?? '').trim()
  if (result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new ReversalDataError(`Invalid ${field} filter.`, { code: 'INVALID_FILTER', status: 400 })
  }
  return result
}

function decodeBase58(value) {
  let decoded = 0n
  let leadingZeroes = 0
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character)
    if (digit < 0) return null
    decoded = decoded * 58n + BigInt(digit)
  }
  while (value[leadingZeroes] === '1') leadingZeroes += 1
  let hex = decoded.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const body = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex')
  return Buffer.concat([Buffer.alloc(leadingZeroes), body])
}

export function isValidRavencoinAddress(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{34}$/.test(value)) return false
  const decoded = decodeBase58(value)
  if (!decoded || decoded.length !== 25 || !RAVENCOIN_ADDRESS_VERSIONS.has(decoded[0])) return false
  const payload = decoded.subarray(0, 21)
  const expected = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest().subarray(0, 4)
  return crypto.timingSafeEqual(decoded.subarray(21), expected)
}

function exactAddressFilter(value, field) {
  const result = exactString(value, field)
  if (result && !isValidRavencoinAddress(result)) {
    throw new ReversalDataError(`${field} must be a valid Ravencoin mainnet address.`, { code: 'INVALID_FILTER', status: 400 })
  }
  return result
}

function resolveDataDirectory({ dataDir, projectRoot }) {
  if (dataDir) return path.resolve(dataDir)
  if (process.env.REVERSAL_DATA_DIR) return path.resolve(process.env.REVERSAL_DATA_DIR)
  const candidates = process.env.NODE_ENV === 'development'
    ? [path.join(projectRoot, 'public', 'data'), path.join(projectRoot, 'dist', 'data')]
    : [path.join(projectRoot, 'dist', 'data'), path.join(projectRoot, 'public', 'data')]
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, SUMMARY_FILE))) ?? candidates[0]
}

async function readRequiredCsv(dataDir, fileName) {
  try {
    return await fs.promises.readFile(path.join(dataDir, fileName), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ReversalDataError(`Required reconciliation file is missing: ${fileName}.`, {
        code: 'REVERSAL_DATA_UNAVAILABLE', status: 503,
      })
    }
    throw error
  }
}

async function readOptionalMetadata(dataDir) {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(dataDir, METADATA_FILE), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    if (error instanceof SyntaxError) throw new ReversalDataError(`${METADATA_FILE} is not valid JSON.`)
    throw error
  }
}

function assertPublishedFile(metadata, key, text, fileName) {
  const expected = metadata?.files?.[key]
  if (!expected) return
  const bytes = Buffer.from(text, 'utf8')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  if (expected.sha256 && expected.sha256 !== sha256) {
    throw new ReversalDataError(`${fileName} does not match its published SHA-256 digest.`)
  }
  if (expected.bytes != null && Number(expected.bytes) !== bytes.length) {
    throw new ReversalDataError(`${fileName} does not match its published byte size.`)
  }
}

function normalizeSummary(row) {
  if (!/^[a-fA-F0-9]{64}$/.test(row.txid)) throw new ReversalDataError(`Invalid transaction ID: ${row.txid}.`)
  const replayStatus = row.replay_status.trim().toUpperCase()
  if (!replayStatus) throw new ReversalDataError(`Transaction ${row.txid} has no replay status.`)
  return {
    txid: row.txid.toLowerCase(),
    exploitChainHeight: parseInteger(row.exploit_chain_height, 'exploit_chain_height'),
    replayStatus,
    notReplayableReason: row.not_replayable_reason || null,
    confirmedHeight: parseInteger(row.confirmed_height, 'confirmed_height', { nullable: true }),
    totalOutputRvn: assertAmount(row.out_value_rvn, 'out_value_rvn'),
    nIn: parseInteger(row.n_in, 'n_in'),
    nOut: parseInteger(row.n_out, 'n_out'),
    fromForgedBlock: parseBoolean(row.from_forged_block, 'from_forged_block'),
    asset: row.asset || null,
    outputAddresses: row.output_addresses ? row.output_addresses.split('|').filter(Boolean) : [],
  }
}

function normalizeInput(row) {
  if (!/^[a-fA-F0-9]{64}$/.test(row.txid) || !/^[a-fA-F0-9]{64}$/.test(row.prev_txid)) {
    throw new ReversalDataError('Normalized input data contains an invalid transaction ID.')
  }
  return {
    txid: row.txid.toLowerCase(),
    vinIndex: parseInteger(row.vin_index, 'vin_index'),
    prevTxid: row.prev_txid.toLowerCase(),
    prevVout: parseInteger(row.prev_vout, 'prev_vout'),
    inputAddress: row.input_address || null,
    valueRvn: assertAmount(row.value_rvn, 'input value_rvn', { nullable: true }),
    assetName: row.asset_name || null,
    assetAmount: assertAmount(row.asset_amount, 'input asset_amount', { nullable: true }),
  }
}

function normalizeOutput(row) {
  if (!/^[a-fA-F0-9]{64}$/.test(row.txid)) throw new ReversalDataError('Normalized output data contains an invalid transaction ID.')
  return {
    txid: row.txid.toLowerCase(),
    voutIndex: parseInteger(row.vout_index, 'vout_index'),
    outputAddress: row.output_address || null,
    valueRvn: assertAmount(row.value_rvn, 'output value_rvn'),
    scriptType: row.script_type || null,
    assetName: row.asset_name || null,
    assetAmount: assertAmount(row.asset_amount, 'output asset_amount', { nullable: true }),
    assetType: row.asset_type || null,
  }
}

function normalizeSpend(row) {
  if (!/^[a-fA-F0-9]{64}$/.test(row.origin_txid) || !/^[a-fA-F0-9]{64}$/.test(row.spent_by_txid)) {
    throw new ReversalDataError('One-hop spend data contains an invalid transaction ID.')
  }
  return {
    originTxid: row.origin_txid.toLowerCase(),
    originVoutIndex: parseInteger(row.origin_vout_index, 'origin_vout_index'),
    originOutputAddress: row.origin_output_address || null,
    originValueRvn: assertAmount(row.origin_value_rvn, 'origin_value_rvn'),
    spentByTxid: row.spent_by_txid.toLowerCase(),
    spentByVin: parseInteger(row.spent_by_vin, 'spent_by_vin'),
    spentHeight: parseInteger(row.spent_height, 'spent_height'),
    spentVoutIndex: parseInteger(row.spent_vout_index, 'spent_vout_index'),
    spentOutputAddress: row.spent_output_address || null,
    spentValueRvn: assertAmount(row.spent_value_rvn, 'spent_value_rvn'),
    spentScriptType: row.spent_script_type || null,
  }
}

function groupByTransaction(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const current = grouped.get(row.txid) ?? []
    current.push(row)
    grouped.set(row.txid, current)
  }
  return grouped
}

async function loadDataset(dataDir) {
  const [summaryText, inputsText, outputsText, spendsText, suppliedMetadata] = await Promise.all([
    readRequiredCsv(dataDir, SUMMARY_FILE),
    readRequiredCsv(dataDir, INPUTS_FILE),
    readRequiredCsv(dataDir, OUTPUTS_FILE),
    readRequiredCsv(dataDir, SPENDS_FILE),
    readOptionalMetadata(dataDir),
  ])
  assertPublishedFile(suppliedMetadata, 'transactions', summaryText, SUMMARY_FILE)
  assertPublishedFile(suppliedMetadata, 'canonicalInputs', inputsText, INPUTS_FILE)
  assertPublishedFile(suppliedMetadata, 'canonicalOutputs', outputsText, OUTPUTS_FILE)
  assertPublishedFile(suppliedMetadata, 'canonicalDirectSpends', spendsText, SPENDS_FILE)
  const summaryRaw = parseCsv(summaryText, { fileName: SUMMARY_FILE })
  const inputsRaw = parseCsv(inputsText, { fileName: INPUTS_FILE })
  const outputsRaw = parseCsv(outputsText, { fileName: OUTPUTS_FILE })
  const spendsRaw = parseCsv(spendsText, { fileName: SPENDS_FILE })
  assertHeaders(summaryRaw, REQUIRED_SUMMARY_HEADERS, SUMMARY_FILE)
  assertHeaders(inputsRaw, REQUIRED_INPUT_HEADERS, INPUTS_FILE)
  assertHeaders(outputsRaw, REQUIRED_OUTPUT_HEADERS, OUTPUTS_FILE)
  assertHeaders(spendsRaw, REQUIRED_SPEND_HEADERS, SPENDS_FILE)

  const summaries = summaryRaw.map(normalizeSummary)
  const inputs = inputsRaw.map(normalizeInput)
  const outputs = outputsRaw.map(normalizeOutput)
  const spends = spendsRaw.map(normalizeSpend)
  const byTxid = new Map()
  for (const summary of summaries) {
    if (byTxid.has(summary.txid)) throw new ReversalDataError(`Duplicate transaction ID in summary data: ${summary.txid}.`)
    if (!summary.outputAddresses.length || summary.outputAddresses.some((address) => !isValidRavencoinAddress(address))) {
      throw new ReversalDataError(`Transaction ${summary.txid} contains an invalid Ravencoin output address.`)
    }
    byTxid.set(summary.txid, summary)
  }
  for (const detail of [...inputs, ...outputs]) {
    if (!byTxid.has(detail.txid)) throw new ReversalDataError(`Normalized data references unknown transaction ${detail.txid}.`)
  }
  for (const input of inputs) {
    if (input.inputAddress && !isValidRavencoinAddress(input.inputAddress)) {
      throw new ReversalDataError(`Normalized input data contains an invalid Ravencoin address for ${input.txid}:${input.vinIndex}.`)
    }
  }
  for (const output of outputs) {
    if (output.outputAddress && !isValidRavencoinAddress(output.outputAddress)) {
      throw new ReversalDataError(`Normalized output data contains an invalid Ravencoin address for ${output.txid}:${output.voutIndex}.`)
    }
  }

  const inputsByTxid = groupByTransaction(inputs)
  const outputsByTxid = groupByTransaction(outputs)
  const statusCounts = {}
  const reasonCounts = {}
  for (const summary of summaries) {
    statusCounts[summary.replayStatus] = (statusCounts[summary.replayStatus] ?? 0) + 1
    if (summary.notReplayableReason) reasonCounts[summary.notReplayableReason] = (reasonCounts[summary.notReplayableReason] ?? 0) + 1
    const transactionInputs = inputsByTxid.get(summary.txid) ?? []
    const transactionOutputs = outputsByTxid.get(summary.txid) ?? []
    if (summary.replayStatus !== 'CONFIRMED') {
      if (transactionInputs.length || transactionOutputs.length) {
        throw new ReversalDataError(`Fork-only transaction ${summary.txid} must not be presented as normalized canonical data.`)
      }
      continue
    }
    if (transactionInputs.length !== summary.nIn || transactionOutputs.length !== summary.nOut) {
      throw new ReversalDataError(`Normalized input/output counts do not match confirmed transaction ${summary.txid}.`)
    }
    if (new Set(transactionInputs.map((input) => input.vinIndex)).size !== transactionInputs.length
      || new Set(transactionOutputs.map((output) => output.voutIndex)).size !== transactionOutputs.length) {
      throw new ReversalDataError(`Normalized data contains duplicate input/output indexes for ${summary.txid}.`)
    }
    const normalizedOutputTotal = transactionOutputs.reduce((total, output) => total + decimalToSatoshis(output.valueRvn), 0n)
    if (normalizedOutputTotal !== decimalToSatoshis(summary.totalOutputRvn)) {
      throw new ReversalDataError(`Normalized output value does not match confirmed transaction ${summary.txid}.`)
    }
    const normalizedAddresses = new Set(transactionOutputs.map((output) => output.outputAddress).filter(Boolean))
    if (normalizedAddresses.size !== summary.outputAddresses.length
      || summary.outputAddresses.some((address) => !normalizedAddresses.has(address))) {
      throw new ReversalDataError(`Normalized output addresses do not match confirmed transaction ${summary.txid}.`)
    }
  }

  const spendsByOriginTxid = new Map()
  const originSpendIdentity = new Map()
  const childInputIdentity = new Map()
  const childTransactionHeight = new Map()
  const childOutputIdentity = new Map()
  const exactSpendRows = new Set()
  for (const spend of spends) {
    if ((spend.originOutputAddress && !isValidRavencoinAddress(spend.originOutputAddress))
      || (spend.spentOutputAddress && !isValidRavencoinAddress(spend.spentOutputAddress))) {
      throw new ReversalDataError(`One-hop spend contains an invalid Ravencoin address for ${spend.originTxid}:${spend.originVoutIndex}.`)
    }
    const summary = byTxid.get(spend.originTxid)
    if (!summary || summary.replayStatus !== 'CONFIRMED') {
      throw new ReversalDataError(`One-hop spend references a non-canonical origin transaction: ${spend.originTxid}.`)
    }
    const originOutput = (outputsByTxid.get(spend.originTxid) ?? [])
      .find((output) => output.voutIndex === spend.originVoutIndex)
    if (!originOutput
      || originOutput.outputAddress !== spend.originOutputAddress
      || decimalToSatoshis(originOutput.valueRvn) !== decimalToSatoshis(spend.originValueRvn)) {
      throw new ReversalDataError(`One-hop spend origin does not match normalized output ${spend.originTxid}:${spend.originVoutIndex}.`)
    }

    const originKey = `${spend.originTxid}:${spend.originVoutIndex}`
    const spenderIdentity = `${spend.spentByTxid}:${spend.spentByVin}:${spend.spentHeight}`
    const existingSpender = originSpendIdentity.get(originKey)
    if (existingSpender && existingSpender !== spenderIdentity) {
      throw new ReversalDataError(`One-hop spend has inconsistent spender data for ${originKey}.`)
    }
    originSpendIdentity.set(originKey, spenderIdentity)

    const childInputKey = `${spend.spentByTxid}:${spend.spentByVin}`
    const existingOrigin = childInputIdentity.get(childInputKey)
    if (existingOrigin && existingOrigin !== originKey) {
      throw new ReversalDataError(`One-hop spend input ${childInputKey} references inconsistent origins.`)
    }
    childInputIdentity.set(childInputKey, originKey)

    const existingSpentHeight = childTransactionHeight.get(spend.spentByTxid)
    if (existingSpentHeight != null && existingSpentHeight !== spend.spentHeight) {
      throw new ReversalDataError(`One-hop spending transaction ${spend.spentByTxid} has inconsistent heights.`)
    }
    childTransactionHeight.set(spend.spentByTxid, spend.spentHeight)

    const childOutputKey = `${spend.spentByTxid}:${spend.spentVoutIndex}`
    const childOutputValue = `${spend.spentValueRvn}:${spend.spentScriptType ?? ''}`
    const existingChildOutput = childOutputIdentity.get(childOutputKey)
    if (existingChildOutput && existingChildOutput !== childOutputValue) {
      throw new ReversalDataError(`One-hop spend has inconsistent child output data for ${childOutputKey}.`)
    }
    childOutputIdentity.set(childOutputKey, childOutputValue)

    const exactRowKey = `${originKey}:${spenderIdentity}:${childOutputKey}:${spend.spentOutputAddress ?? ''}`
    if (exactSpendRows.has(exactRowKey)) throw new ReversalDataError(`One-hop spend data contains a duplicate path for ${originKey}.`)
    exactSpendRows.add(exactRowKey)

    const childSummary = byTxid.get(spend.spentByTxid)
    if (childSummary?.replayStatus === 'CONFIRMED') {
      const childInput = (inputsByTxid.get(spend.spentByTxid) ?? [])
        .find((input) => input.vinIndex === spend.spentByVin)
      const childOutput = (outputsByTxid.get(spend.spentByTxid) ?? [])
        .find((output) => output.voutIndex === spend.spentVoutIndex)
      if (!childInput || childInput.prevTxid !== spend.originTxid || childInput.prevVout !== spend.originVoutIndex) {
        throw new ReversalDataError(`One-hop spender input does not reference origin ${originKey}.`)
      }
      if (!childOutput
        || childOutput.outputAddress !== spend.spentOutputAddress
        || decimalToSatoshis(childOutput.valueRvn) !== decimalToSatoshis(spend.spentValueRvn)
        || childOutput.scriptType !== spend.spentScriptType) {
        throw new ReversalDataError(`One-hop spender output does not match normalized output ${spend.spentByTxid}:${spend.spentVoutIndex}.`)
      }
    }

    const transactionSpends = spendsByOriginTxid.get(spend.originTxid) ?? []
    transactionSpends.push(spend)
    spendsByOriginTxid.set(spend.originTxid, transactionSpends)
  }

  const sha256 = crypto.createHash('sha256').update(Buffer.from(summaryText, 'utf8')).digest('hex')
  const spendsSha256 = crypto.createHash('sha256').update(Buffer.from(spendsText, 'utf8')).digest('hex')
  return {
    summaries,
    inputsByTxid,
    outputsByTxid,
    spendsByOriginTxid,
    statuses: Object.keys(statusCounts).sort(),
    reasons: Object.keys(reasonCounts).sort(),
    metadata: {
      ...(suppliedMetadata ?? {}),
      sha256,
      spendsSha256,
      transactionCount: summaries.length,
      statusCounts,
      reasonCounts,
      onwardPathCount: spends.length,
      onwardOriginOutputCount: originSpendIdentity.size,
      onwardSpendingTransactionCount: new Set(spends.map((spend) => spend.spentByTxid)).size,
      files: {
        summary: `/data/${SUMMARY_FILE}`,
        inputs: `/data/${INPUTS_FILE}`,
        outputs: `/data/${OUTPUTS_FILE}`,
        spends: `/data/${SPENDS_FILE}`,
        metadata: `/data/${METADATA_FILE}`,
      },
    },
  }
}

function normalizeFilters(query, dataset) {
  const suppliedQ = exactString(query.q, 'transaction ID')
  const suppliedTxid = exactString(query.txid, 'transaction ID')
  if (suppliedQ && suppliedTxid && suppliedQ.toLowerCase() !== suppliedTxid.toLowerCase()) {
    throw new ReversalDataError('q and txid filters must refer to the same transaction when both are supplied.', {
      code: 'INVALID_FILTER', status: 400,
    })
  }
  const q = suppliedQ || suppliedTxid
  if (q && !/^[a-fA-F0-9]{64}$/.test(q)) {
    throw new ReversalDataError('Transaction ID filters must be an exact 64-character hexadecimal ID.', {
      code: 'INVALID_FILTER', status: 400,
    })
  }
  const from = exactAddressFilter(query.from, 'Source address')
  const to = exactAddressFilter(query.to, 'Destination address')
  const onward = exactAddressFilter(query.onward, 'Next-hop address')
  const status = exactString(query.status, 'status').toUpperCase()
  const reason = exactString(query.reason, 'reason')
  if (status && !dataset.statuses.includes(status)) {
    throw new ReversalDataError(`Unknown replay status: ${status}.`, { code: 'INVALID_FILTER', status: 400 })
  }
  if (reason && !dataset.reasons.includes(reason)) {
    throw new ReversalDataError(`Unknown non-replayable reason: ${reason}.`, { code: 'INVALID_FILTER', status: 400 })
  }
  const rawLimit = exactString(query.limit, 'limit', 16)
  const rawOffset = exactString(query.offset, 'offset', 16)
  if ((rawLimit && !/^\d+$/.test(rawLimit)) || (rawOffset && !/^\d+$/.test(rawOffset))) {
    throw new ReversalDataError('Pagination values must be non-negative integers.', { code: 'INVALID_FILTER', status: 400 })
  }
  const parsedLimit = rawLimit ? Number(rawLimit) : 50
  const parsedOffset = rawOffset ? Number(rawOffset) : 0
  if (!Number.isSafeInteger(parsedLimit) || !Number.isSafeInteger(parsedOffset)) {
    throw new ReversalDataError('Pagination values are outside the safe integer range.', { code: 'INVALID_FILTER', status: 400 })
  }
  const limit = Math.min(500, Math.max(1, parsedLimit))
  const offset = Math.max(0, parsedOffset)
  return { q: q.toLowerCase(), from, to, onward, status, reason, limit, offset }
}

function uniqueOnwardOutputTotal(spends) {
  const uniqueOutputs = new Map()
  for (const spend of spends) {
    const key = `${spend.spentByTxid}:${spend.spentVoutIndex}`
    const existing = uniqueOutputs.get(key)
    if (existing != null && existing !== spend.spentValueRvn) {
      throw new ReversalDataError(`One-hop destination value is inconsistent for ${key}.`)
    }
    uniqueOutputs.set(key, spend.spentValueRvn)
  }
  return [...uniqueOutputs.values()].reduce((total, value) => total + decimalToSatoshis(value), 0n)
}

function enrichSummary(summary, dataset, filters) {
  const canonicalExact = summary.replayStatus === 'CONFIRMED'
  const inputs = canonicalExact ? (dataset.inputsByTxid.get(summary.txid) ?? []) : null
  const outputs = canonicalExact ? (dataset.outputsByTxid.get(summary.txid) ?? []) : null
  const inputAddresses = inputs ? [...new Set(inputs.map((input) => input.inputAddress).filter(Boolean))] : null
  const exactOutputAddresses = outputs ? [...new Set(outputs.map((output) => output.outputAddress).filter(Boolean))] : null
  const matchedOutputs = filters.to && outputs
    ? outputs.filter((output) => output.outputAddress === filters.to)
    : null
  const matchedOutputRvn = matchedOutputs
    ? satoshisToDecimal(matchedOutputs.reduce((total, output) => total + decimalToSatoshis(output.valueRvn), 0n))
    : null
  const allOnwardSpends = canonicalExact ? (dataset.spendsByOriginTxid.get(summary.txid) ?? []) : null
  const onwardSpends = allOnwardSpends && (filters.to || filters.onward)
    ? allOnwardSpends.filter((spend) => (
      (!filters.to || spend.originOutputAddress === filters.to)
      && (!filters.onward || spend.spentOutputAddress === filters.onward)
    ))
    : allOnwardSpends
  const matchedOnwardOutputRvn = filters.onward && onwardSpends
    ? satoshisToDecimal(uniqueOnwardOutputTotal(onwardSpends))
    : null
  return {
    ...summary,
    evidenceCoverage: canonicalExact ? 'canonical-exact' : 'fork-summary-only',
    inputAddresses,
    exactOutputAddresses,
    inputs,
    outputs,
    matchedOutputs,
    matchedOutputRvn,
    onwardSpends,
    matchedOnwardOutputRvn,
  }
}

function rowMatches(summary, dataset, filters) {
  if (filters.q && summary.txid !== filters.q) return false
  if (filters.status && summary.replayStatus !== filters.status) return false
  if (filters.reason && summary.notReplayableReason !== filters.reason) return false
  const canonicalExact = summary.replayStatus === 'CONFIRMED'
  const inputs = canonicalExact ? (dataset.inputsByTxid.get(summary.txid) ?? []) : []
  const outputs = canonicalExact ? (dataset.outputsByTxid.get(summary.txid) ?? []) : []
  if (filters.from && !inputs.some((input) => input.inputAddress === filters.from)) return false
  if (filters.to) {
    const hasDestination = canonicalExact
      ? outputs.some((output) => output.outputAddress === filters.to)
      : summary.outputAddresses.includes(filters.to)
    if (!hasDestination) return false
  }
  if (filters.onward) {
    const hasOnwardDestination = canonicalExact
      && (dataset.spendsByOriginTxid.get(summary.txid) ?? [])
        .some((spend) => (
          (!filters.to || spend.originOutputAddress === filters.to)
          && spend.spentOutputAddress === filters.onward
        ))
    if (!hasOnwardDestination) return false
  }
  return true
}

function filterDataset(dataset, filters) {
  return dataset.summaries.filter((summary) => rowMatches(summary, dataset, filters))
}

export function protectSpreadsheetCell(value) {
  const text = value == null ? '' : String(value)
  return /^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text) ? `'${text}` : text
}

export function encodeCsvCell(value) {
  const safe = protectSpreadsheetCell(value)
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

const DOWNLOAD_HEADERS = [
  'txid', 'exploit_chain_height', 'replay_status', 'not_replayable_reason',
  'confirmed_height', 'out_value_rvn', 'n_in', 'n_out', 'from_forged_block',
  'asset', 'output_addresses', 'input_addresses', 'exact_output_addresses',
  'matching_vouts', 'matched_output_rvn', 'onward_address', 'onward_paths',
  'matched_onward_output_rvn', 'evidence_coverage',
]

function serializeOnwardPath(spend) {
  return [
    `${spend.originTxid}:${spend.originVoutIndex}`,
    spend.originOutputAddress ?? '',
    spend.originValueRvn,
    `${spend.spentByTxid}:${spend.spentByVin}@${spend.spentHeight}`,
    `${spend.spentVoutIndex}:${spend.spentOutputAddress ?? ''}:${spend.spentValueRvn}`,
  ].join('>')
}

function serializeDownloadRow(row, filters) {
  return [
    row.txid,
    row.exploitChainHeight,
    row.replayStatus,
    row.notReplayableReason,
    row.confirmedHeight,
    row.totalOutputRvn,
    row.nIn,
    row.nOut,
    row.fromForgedBlock,
    row.asset,
    row.outputAddresses.join('|'),
    row.inputAddresses?.join('|'),
    row.exactOutputAddresses?.join('|'),
    row.matchedOutputs?.map((output) => `${output.voutIndex}:${output.outputAddress}:${output.valueRvn}`).join('|'),
    row.matchedOutputRvn,
    filters.onward || null,
    row.onwardSpends?.map(serializeOnwardPath).join('|'),
    row.matchedOnwardOutputRvn,
    row.evidenceCoverage,
  ].map(encodeCsvCell).join(',')
}

export function createReversalDataService({ dataDir, projectRoot = path.resolve('.') } = {}) {
  const resolvedDataDir = resolveDataDirectory({ dataDir, projectRoot })
  let datasetPromise
  const getDataset = () => {
    datasetPromise ??= loadDataset(resolvedDataDir).catch((error) => {
      datasetPromise = null
      throw error
    })
    return datasetPromise
  }

  return {
    dataDir: resolvedDataDir,
    async search(query = {}) {
      const dataset = await getDataset()
      const filters = normalizeFilters(query, dataset)
      const matching = filterDataset(dataset, filters)
      const items = matching.slice(filters.offset, filters.offset + filters.limit)
        .map((summary) => enrichSummary(summary, dataset, filters))
      return {
        items,
        total: matching.length,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: filters.offset + items.length < matching.length,
        filters: { q: filters.q || null, from: filters.from || null, to: filters.to || null, onward: filters.onward || null, status: filters.status || null, reason: filters.reason || null },
        availableFilters: { statuses: dataset.statuses, reasons: dataset.reasons },
        coverage: REVERSAL_COVERAGE,
        dataset: dataset.metadata,
      }
    },
    async download(query = {}) {
      const dataset = await getDataset()
      const filters = normalizeFilters({ ...query, limit: 500, offset: 0 }, dataset)
      const matching = filterDataset(dataset, filters)
      const lines = [DOWNLOAD_HEADERS.join(',')]
      for (const summary of matching) lines.push(serializeDownloadRow(enrichSummary(summary, dataset, filters), filters))
      return {
        body: `${lines.join('\r\n')}\r\n`,
        count: matching.length,
        sha256: dataset.metadata.sha256,
      }
    },
  }
}
