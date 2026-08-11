const SATOSHIS = 100_000_000

export class RpcError extends Error {
  constructor(message, code = -1, status = 502) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.status = status
  }
}

export class RavenRpc {
  constructor(options = {}) {
    this.url = options.url ?? process.env.RAVEN_RPC_URL ?? 'http://127.0.0.1:8766'
    this.user = options.user ?? process.env.RAVEN_RPC_USER ?? ''
    this.password = options.password ?? process.env.RAVEN_RPC_PASSWORD ?? ''
    this.timeout = (options.timeout ?? Number(process.env.RAVEN_RPC_TIMEOUT_MS)) || 4_000
  }

  async call(method, params = []) {
    let response
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${this.user}:${this.password}`).toString('base64')}`,
        },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'raven-scout', method, params }),
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch (error) {
      throw new RpcError(`Ravencoin RPC is unavailable: ${error.message}`, -1, 503)
    }

    if (!response.ok) throw new RpcError(`Ravencoin RPC returned HTTP ${response.status}`, response.status)
    const payload = await response.json()
    if (payload.error) throw new RpcError(payload.error.message ?? 'Ravencoin RPC error', payload.error.code)
    return payload.result
  }
}

export const satsToCoin = (value) => Number(value ?? 0) / SATOSHIS

export function normalizeTransaction(tx, details = {}) {
  const outputs = (tx.vout ?? []).map((output) => {
    const script = output.scriptPubKey ?? {}
    const asset = script.asset ?? output.asset ?? null
    return {
      n: output.n,
      value: Number(output.value ?? 0),
      addresses: script.addresses ?? (script.address ? [script.address] : []),
      type: script.type ?? 'unknown',
      asset: asset ? {
        name: asset.name ?? asset.asset_name ?? asset.assetName,
        amount: Number(asset.amount ?? asset.qty ?? 0),
        type: asset.type ?? null,
      } : null,
    }
  })
  const totalOutput = outputs.reduce((sum, output) => sum + output.value, 0)
  const totalInput = details.totalInput ?? null
  return {
    txid: tx.txid,
    blockHash: tx.blockhash ?? details.blockHash ?? null,
    blockHeight: details.blockHeight ?? null,
    confirmations: tx.confirmations ?? details.confirmations ?? 0,
    time: tx.blocktime ?? tx.time ?? details.time ?? null,
    size: tx.size ?? null,
    vsize: tx.vsize ?? tx.size ?? null,
    version: tx.version,
    locktime: tx.locktime,
    totalInput,
    totalOutput,
    fee: totalInput == null ? null : Math.max(0, totalInput - totalOutput),
    vin: (tx.vin ?? []).map((input) => ({
      txid: input.txid ?? null,
      vout: input.vout ?? null,
      coinbase: input.coinbase ?? null,
      sequence: input.sequence,
      address: input.address ?? null,
      value: input.value == null ? null : Number(input.value),
    })),
    vout: outputs,
  }
}

export function normalizeBlock(block) {
  return {
    height: block.height,
    hash: block.hash,
    time: block.time,
    size: block.size,
    txCount: Number(block.nTx ?? block.tx?.length ?? 0),
    confirmations: block.confirmations ?? 0,
    difficulty: block.difficulty,
    version: block.version,
    merkleRoot: block.merkleroot,
    nonce: block.nonce,
    bits: block.bits,
    previousBlockHash: block.previousblockhash ?? null,
    nextBlockHash: block.nextblockhash ?? null,
    transactions: (block.tx ?? []).map((tx) => typeof tx === 'string' ? { txid: tx } : normalizeTransaction(tx, {
      blockHash: block.hash,
      blockHeight: block.height,
      confirmations: block.confirmations,
      time: block.time,
    })),
  }
}

export function normalizeAsset(name, asset = {}) {
  return {
    name: asset.name ?? name,
    amount: Number(asset.amount ?? 0),
    units: Number(asset.units ?? 0),
    reissuable: Boolean(asset.reissuable),
    hasIpfs: Boolean(asset.has_ipfs),
    ipfsHash: asset.ipfs_hash ?? asset.txid_hash ?? null,
    blockHeight: asset.block_height ?? null,
    blockHash: asset.blockhash ?? null,
  }
}

export async function getLiveStatus(rpc) {
  const [chain, network, mempool, mining] = await Promise.all([
    rpc.call('getblockchaininfo'),
    rpc.call('getnetworkinfo'),
    rpc.call('getmempoolinfo'),
    rpc.call('getmininginfo'),
  ])
  const header = await rpc.call('getblockheader', [chain.bestblockhash])
  return {
    chain: chain.chain,
    blocks: chain.blocks,
    headers: chain.headers,
    bestBlockHash: chain.bestblockhash,
    verificationProgress: chain.verificationprogress,
    difficulty: chain.difficulty,
    sizeOnDisk: chain.size_on_disk,
    protocolVersion: network.protocolversion,
    subversion: network.subversion,
    mempoolTransactions: mempool.size,
    mempoolBytes: mempool.bytes,
    networkHashrate: mining.networkhashps,
    minutesSinceLastBlock: Math.max(0, (Date.now() / 1000 - header.time) / 60),
  }
}

export async function getLiveBlocks(rpc, limit = 8, start) {
  const height = start ?? await rpc.call('getblockcount')
  const heights = Array.from({ length: Math.min(limit, height + 1) }, (_, i) => height - i)
  const hashes = await Promise.all(heights.map((item) => rpc.call('getblockhash', [item])))
  const blocks = await Promise.all(hashes.map((hash) => rpc.call('getblock', [hash, 1])))
  return blocks.map(normalizeBlock)
}

export async function getLiveBlock(rpc, id) {
  const hash = /^\d+$/.test(String(id)) ? await rpc.call('getblockhash', [Number(id)]) : id
  return normalizeBlock(await rpc.call('getblock', [hash, 2]))
}

export async function getLiveTransaction(rpc, txid) {
  return normalizeTransaction(await rpc.call('getrawtransaction', [txid, true]))
}

export async function getLiveAddress(rpc, address) {
  const query = { addresses: [address] }
  const [rawBalances, rawUtxos, txids] = await Promise.all([
    rpc.call('getaddressbalance', [query, true]),
    rpc.call('getaddressutxos', [{ ...query, assetName: '*' }]),
    rpc.call('getaddresstxids', [query, true]),
  ])
  const balances = (Array.isArray(rawBalances) ? rawBalances : [{ assetName: 'RVN', ...rawBalances }]).map((balance) => ({
    assetName: balance.assetName,
    balance: satsToCoin(balance.balance),
    received: satsToCoin(balance.received),
  }))
  const recentIds = [...new Set(txids)].slice(-15).reverse()
  const transactions = await Promise.all(recentIds.map(async (txid) => {
    try { return await getLiveTransaction(rpc, txid) } catch { return { txid } }
  }))
  const raven = balances.find((balance) => balance.assetName === 'RVN') ?? { balance: 0, received: 0 }
  return {
    address,
    balance: raven.balance,
    received: raven.received,
    sent: Math.max(0, raven.received - raven.balance),
    transactionCount: txids.length,
    balances,
    utxos: rawUtxos.map((utxo) => ({
      address: utxo.address,
      assetName: utxo.assetName,
      txid: utxo.txid,
      outputIndex: utxo.outputIndex,
      amount: satsToCoin(utxo.satoshis),
      height: utxo.height,
    })),
    transactions,
  }
}

export async function getLiveAssets(rpc, query = '', limit = 30, offset = 0) {
  const filter = query ? `${query.toUpperCase()}*` : '*'
  const result = await rpc.call('listassets', [filter, true, limit, offset])
  return Object.entries(result ?? {}).map(([name, asset]) => normalizeAsset(name, asset))
}

export async function getLiveAsset(rpc, name) {
  const result = await rpc.call('listassets', [decodeURIComponent(name).toUpperCase(), true, 1, 0])
  const entry = Object.entries(result ?? {})[0]
  if (!entry) throw new RpcError('Asset not found', -5, 404)
  return normalizeAsset(entry[0], entry[1])
}
