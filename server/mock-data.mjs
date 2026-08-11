import { createHash } from 'node:crypto'

export const DEMO_HEIGHT = 3_388_421
export const DEMO_ADDRESS = 'RXBurnXXXXXXXXXXXXXXXXXXXXXXWUo9FV'

export const hashFor = (value) => createHash('sha256').update(String(value)).digest('hex')

const now = Math.floor(Date.now() / 1000)

const addressPool = [
  DEMO_ADDRESS,
  'RNX9V5eu7dNA7vQdFTVb9B7wYJ7UN4MWtW',
  'RAvENxFNBM8Y6TPdruvE4obq1P6sxJC8kS',
  'RUwZQdFyFvDeeqJfz9BbmKyqWteJucPUcq',
]

export function mockStatus() {
  return {
    chain: 'main',
    blocks: DEMO_HEIGHT,
    headers: DEMO_HEIGHT,
    bestBlockHash: hashFor(`block-${DEMO_HEIGHT}`),
    verificationProgress: 1,
    difficulty: 67_842.483,
    sizeOnDisk: 119_482_663_104,
    protocolVersion: 70_028,
    subversion: '/Ravencoin:4.6.1/',
    mempoolTransactions: 14,
    mempoolBytes: 18_402,
    networkHashrate: 6_480_000_000_000,
    minutesSinceLastBlock: 1.7,
  }
}

export function mockBlocks(limit = 8, start = DEMO_HEIGHT) {
  return Array.from({ length: limit }, (_, index) => {
    const height = Math.max(0, start - index)
    const txCount = 3 + ((height * 17) % 18)
    return {
      height,
      hash: hashFor(`block-${height}`),
      time: now - index * 63,
      size: 3_921 + ((height * 911) % 64_000),
      txCount,
      confirmations: DEMO_HEIGHT - height + 1,
      difficulty: 67_842.483,
      version: 536_870_912,
      merkleRoot: hashFor(`merkle-${height}`),
      nonce: 1_442_901 + height,
      bits: '1b012c2f',
      previousBlockHash: height ? hashFor(`block-${height - 1}`) : null,
      nextBlockHash: height < DEMO_HEIGHT ? hashFor(`block-${height + 1}`) : null,
      transactions: Array.from({ length: txCount }, (__, txIndex) => mockTransaction(hashFor(`tx-${height}-${txIndex}`), height, txIndex)),
    }
  })
}

export function mockBlock(id) {
  let height = Number(id)
  if (!Number.isInteger(height)) {
    const candidate = Array.from({ length: 80 }, (_, i) => DEMO_HEIGHT - i).find((h) => hashFor(`block-${h}`) === id)
    height = candidate ?? DEMO_HEIGHT
  }
  return mockBlocks(1, Math.min(Math.max(height, 0), DEMO_HEIGHT))[0]
}

export function mockTransaction(txid = hashFor('tx-demo'), height = DEMO_HEIGHT, index = 1) {
  const blockHeight = Number.isFinite(height) ? height : DEMO_HEIGHT
  const inputValue = 1250 + (index * 73.125)
  const outputValue = inputValue - 0.01
  return {
    txid,
    blockHash: hashFor(`block-${blockHeight}`),
    blockHeight,
    confirmations: Math.max(1, DEMO_HEIGHT - blockHeight + 1),
    time: now - Math.max(0, DEMO_HEIGHT - blockHeight) * 63,
    size: 226 + index * 14,
    vsize: 226 + index * 14,
    version: 2,
    locktime: 0,
    totalInput: inputValue,
    totalOutput: outputValue,
    fee: 0.01,
    vin: index === 0 ? [{ coinbase: hashFor(`coinbase-${blockHeight}`).slice(0, 40), sequence: 4_294_967_295 }] : [{
      txid: hashFor(`previous-${txid}`),
      vout: 0,
      address: addressPool[(index + 1) % addressPool.length],
      value: inputValue,
      sequence: 4_294_967_293,
    }],
    vout: [
      { n: 0, value: outputValue * 0.72, addresses: [addressPool[index % addressPool.length]], type: 'pubkeyhash', asset: null },
      { n: 1, value: outputValue * 0.28, addresses: [addressPool[(index + 2) % addressPool.length]], type: 'pubkeyhash', asset: null },
    ],
  }
}

export function mockAddress(address = DEMO_ADDRESS) {
  const transactions = Array.from({ length: 8 }, (_, i) => mockTransaction(hashFor(`address-${address}-${i}`), DEMO_HEIGHT - i * 3, i + 1))
  return {
    address,
    balance: 12_847.36194218,
    received: 98_204.71042,
    sent: 85_357.34847782,
    transactionCount: transactions.length,
    balances: [
      { assetName: 'RVN', balance: 12_847.36194218, received: 98_204.71042 },
      { assetName: 'RAVENSCOUT', balance: 750, received: 1_000 },
      { assetName: 'COMMUNITY/BUILDERS', balance: 42, received: 42 },
    ],
    utxos: Array.from({ length: 5 }, (_, i) => ({
      address,
      assetName: i > 2 ? 'RAVENSCOUT' : 'RVN',
      txid: transactions[i].txid,
      outputIndex: i % 2,
      amount: i > 2 ? 250 : 1_200.25 + i * 18.4,
      height: DEMO_HEIGHT - i * 3,
    })),
    transactions,
  }
}

export const mockAssets = [
  { name: 'RVN', amount: 21_000_000_000, units: 8, reissuable: false, hasIpfs: false, blockHeight: 0 },
  { name: 'RAVENSCOUT', amount: 1_000_000, units: 2, reissuable: true, hasIpfs: true, ipfsHash: 'QmRavenScoutCommunityExplorer', blockHeight: DEMO_HEIGHT - 824 },
  { name: 'COMMUNITY/BUILDERS', amount: 50_000, units: 0, reissuable: true, hasIpfs: false, blockHeight: DEMO_HEIGHT - 1_249 },
  { name: 'DOMINANTSTRATEGIES', amount: 10_000, units: 0, reissuable: false, hasIpfs: true, ipfsHash: 'QmDominantStrategies', blockHeight: DEMO_HEIGHT - 4_812 },
  { name: 'KOREA/RAVEN', amount: 21_000_000, units: 8, reissuable: true, hasIpfs: false, blockHeight: DEMO_HEIGHT - 7_220 },
  { name: 'ASIA/COMMUNITY', amount: 8_888_888, units: 2, reissuable: true, hasIpfs: true, ipfsHash: 'QmAsiaCommunity', blockHeight: DEMO_HEIGHT - 8_991 },
]

export function mockAsset(name) {
  const asset = mockAssets.find((item) => item.name === decodeURIComponent(name).toUpperCase()) ?? {
    ...mockAssets[1],
    name: decodeURIComponent(name).toUpperCase(),
  }
  return {
    ...asset,
    transfers: Array.from({ length: 7 }, (_, index) => ({
      txid: hashFor(`asset-${asset.name}-${index}`),
      blockHeight: DEMO_HEIGHT - index * 8,
      time: now - index * 8 * 63,
      outputIndex: index % 3,
      type: index === 6 ? 'issue' : index === 3 ? 'reissue' : 'transfer',
      amount: index === 6 ? asset.amount : 25 + index * 12.5,
      fromAddresses: index === 6 ? [] : [addressPool[index % addressPool.length]],
      toAddresses: [addressPool[(index + 1) % addressPool.length]],
    })),
  }
}
