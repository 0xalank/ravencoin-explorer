const DECIMALS = 8
const SCALE = 10n ** BigInt(DECIMALS)

export function decimalToAtomic(value) {
  if (value == null || value === '') return 0n
  let text = typeof value === 'number' ? value.toFixed(DECIMALS) : String(value)
  if (/e/i.test(text)) text = Number(text).toFixed(DECIMALS)
  const negative = text.startsWith('-')
  if (negative) text = text.slice(1)
  const [whole = '0', fraction = ''] = text.split('.')
  const atomic = BigInt(whole || '0') * SCALE + BigInt((fraction + '0'.repeat(DECIMALS)).slice(0, DECIMALS))
  return negative ? -atomic : atomic
}

export function atomicToDecimal(value) {
  const atomic = BigInt(value)
  const negative = atomic < 0n
  const absolute = negative ? -atomic : atomic
  const whole = absolute / SCALE
  const fraction = String(absolute % SCALE).padStart(DECIMALS, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export function extractAsset(output) {
  const script = output?.scriptPubKey ?? {}
  const raw = script.asset ?? output?.asset
  if (!raw?.name) return null
  const scriptType = String(script.type ?? raw.type ?? 'transfer_asset').toLowerCase()
  const type = scriptType.includes('new') ? 'issue' : scriptType.includes('reissue') ? 'reissue' : 'transfer'
  return {
    name: raw.name,
    amount: atomicToDecimal(decimalToAtomic(raw.amount ?? 0)),
    type,
    units: raw.units == null ? null : Number(raw.units),
    reissuable: raw.reissuable == null ? null : Boolean(raw.reissuable),
    ipfsHash: raw.ipfs_hash ?? raw.message ?? null,
  }
}

export function normalizeOutput(output) {
  const script = output?.scriptPubKey ?? {}
  return {
    index: Number(output.n),
    value: atomicToDecimal(decimalToAtomic(output.value ?? 0)),
    scriptType: script.type ?? 'unknown',
    scriptHex: script.hex ?? null,
    addresses: [...new Set(script.addresses ?? (script.address ? [script.address] : []))],
    asset: extractAsset(output),
  }
}

export class BalanceAccumulator {
  constructor() { this.values = new Map() }

  add(address, assetName, amount, direction, height) {
    if (!address || decimalToAtomic(amount) === 0n) return
    const key = `${address}\u0000${assetName}`
    const current = this.values.get(key) ?? { address, assetName, balance: 0n, received: 0n, sent: 0n, height }
    const atomic = decimalToAtomic(amount)
    if (direction === 'receive') { current.balance += atomic; current.received += atomic }
    else { current.balance -= atomic; current.sent += atomic }
    current.height = Math.max(current.height, height)
    this.values.set(key, current)
  }

  rows() {
    return [...this.values.values()].map((item) => ({
      address: item.address,
      asset_name: item.assetName,
      balance: atomicToDecimal(item.balance),
      received: atomicToDecimal(item.received),
      sent: atomicToDecimal(item.sent),
      updated_height: item.height,
    }))
  }
}
