export type DataSource = 'live' | 'demo'

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
}
