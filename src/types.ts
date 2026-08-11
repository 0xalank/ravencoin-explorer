export type DataSource = 'live' | 'indexed' | 'demo'

export interface ApiMeta {
  source: DataSource
  network: string
  updatedAt: string
  fallbackReason?: string
}

export interface ApiEnvelope<T> {
  data: T
  meta: ApiMeta
}

export interface Status {
  chain: string
  blocks: number
  headers: number
  bestBlockHash: string
  verificationProgress: number
  difficulty: number
  sizeOnDisk: number
  protocolVersion: number
  subversion: string
  mempoolTransactions: number
  mempoolBytes: number
  networkHashrate: number
  minutesSinceLastBlock: number
  chainTip?: number
  indexer?: {
    status: 'idle' | 'syncing' | 'ready' | 'error' | 'reorg'
    indexedHeight: number
    rawHeight: number
    targetHeight: number
    progress: number
    indexedBlocks: number
    stagedBlocks: number
    indexedTransactions: number
    indexedAssets: number
    databaseBytes: number
    latencyMs: number
    blocksRemaining: number
    blocksPerSecond: number
    estimatedSecondsRemaining: number | null
    startedAt: number | null
    lastIndexedAt: number | null
    lastError?: string | null
    updatedAt?: string | null
  }
}

export interface NetworkStats {
  windowStartHeight: number
  windowEndHeight: number
  windowStart: number | null
  windowEnd: number | null
  windowBlocks: number
  windowTransactions: number
  activeAddresses: number
  averageBlockTimeSeconds: number
  averageBlockSize: number
  averageTransactionsPerBlock: number
  transactionsPerSecond: number
  averageBlockReward: number
  minedRvn: number
  totalFees: number
  outputVolume: number
  circulatingSupply: number
  totalTransactions: number
  trackedAddresses: number
  totalAssets: number
  history: StatsHistoryPoint[]
}

export interface StatsHistoryPoint {
  timestamp: number
  blocks: number
  transactions: number
  activeAddresses: number
  difficulty: number
}

export interface RankedAddress {
  rank: number
  address: string
  balance: number
  received: number
  sent: number
  transactionCount: number
  blocksMined: number
  lastActivityHeight: number | null
  share: number
}

export interface AddressRankings {
  items: RankedAddress[]
  total: number
  totalBalance: number
  thresholds: Array<{ balance: number; addresses: number }>
}

export interface TxInput {
  txid?: string | null
  vout?: number | null
  coinbase?: string | null
  sequence?: number
  address?: string | null
  value?: number | null
}

export interface TxOutput {
  n: number
  value: number
  addresses: string[]
  type: string
  asset?: { name?: string; amount: number; type?: string | null } | null
}

export interface Transaction {
  txid: string
  blockHash?: string | null
  blockHeight?: number | null
  confirmations?: number
  time?: number | null
  size?: number | null
  vsize?: number | null
  version?: number
  locktime?: number
  totalInput?: number | null
  totalOutput?: number
  fee?: number | null
  vin?: TxInput[]
  vout?: TxOutput[]
}

export interface Block {
  height: number
  hash: string
  time: number
  size: number
  txCount: number
  confirmations: number
  difficulty: number
  version: number
  merkleRoot: string
  nonce: number
  bits: string
  previousBlockHash?: string | null
  nextBlockHash?: string | null
  transactions: Transaction[]
}

export interface AssetBalance {
  assetName: string
  balance: number
  received: number
}

export interface Utxo {
  address: string
  assetName: string
  txid: string
  outputIndex: number
  amount: number
  height: number
}

export interface AddressData {
  address: string
  balance: number
  received: number
  sent: number
  transactionCount: number
  balances: AssetBalance[]
  utxos: Utxo[]
  transactions: Transaction[]
}

export interface Asset {
  name: string
  amount: number
  units: number
  reissuable: boolean
  hasIpfs: boolean
  ipfsHash?: string | null
  blockHeight?: number | null
  blockHash?: string | null
  transfers?: AssetTransfer[]
}

export interface AssetTransfer {
  txid: string
  blockHeight: number
  time: number
  outputIndex: number
  type: 'issue' | 'reissue' | 'transfer'
  amount: number
  fromAddresses: string[]
  toAddresses: string[]
}
