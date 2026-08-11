import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { databaseConfigured, databaseHealth, getPool, migrate } from './db.mjs'
import {
  DEMO_ADDRESS,
  DEMO_HEIGHT,
  mockAddress,
  mockAsset,
  mockAssets,
  mockBlock,
  mockBlocks,
  mockStatus,
  mockTransaction,
} from './mock-data.mjs'
import {
  RavenRpc,
  RpcError,
  getLiveAddress,
  getLiveAsset,
  getLiveAssets,
  getLiveBlock,
  getLiveBlocks,
  getLiveStatus,
  getLiveTransaction,
} from './rpc.mjs'
import {
  getIndexedAddress,
  getIndexedAsset,
  getIndexedAssets,
  getIndexedBlock,
  getIndexedBlocks,
  getIndexedStatus,
  getIndexedTransaction,
  searchIndexed,
} from './repository.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min))

export function createApp(options = {}) {
  const app = express()
  const rpc = options.rpc ?? new RavenRpc()
  const useDatabase = options.useDatabase ?? (process.env.EXPLORER_DATA_SOURCE === 'postgres' || databaseConfigured())
  const pool = options.pool ?? (useDatabase ? getPool() : null)
  const configuredMode = options.demoMode ?? process.env.EXPLORER_DEMO_MODE ?? 'auto'
  const mode = String(configuredMode).toLowerCase()
  const source = useDatabase ? 'indexed' : 'live'
  const cache = new Map()
  const rateWindows = new Map()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '32kb' }))
  app.use((_, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })
    next()
  })
  if (String(process.env.TRUST_PROXY ?? '').toLowerCase() === 'true') app.set('trust proxy', 1)
  app.use('/api', (request, response, next) => {
    if (request.path === '/health') return next()
    const now = Date.now()
    const maximum = Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 180
    const key = request.ip
    const current = rateWindows.get(key)
    const window = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current
    window.count += 1
    rateWindows.set(key, window)
    if (rateWindows.size > 10_000) for (const [ip, value] of rateWindows) if (value.resetAt <= now) rateWindows.delete(ip)
    response.set('X-RateLimit-Limit', String(maximum))
    response.set('X-RateLimit-Remaining', String(Math.max(0, maximum - window.count)))
    if (window.count > maximum) return response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many explorer requests. Try again shortly.' } })
    next()
  })

  const envelope = (data, source, extra = {}) => ({
    data,
    meta: { source, network: 'main', updatedAt: new Date().toISOString(), ...extra },
  })

  const withData = (live, demo, cacheSeconds = 0) => async (request, response, next) => {
    try {
      if (mode === 'true' || mode === 'demo') return response.json(envelope(await demo(request), 'demo'))
      try {
        const key = `${source}:${request.originalUrl}`
        const current = cache.get(key)
        let pending
        if (cacheSeconds && current?.expires > Date.now()) pending = current.value
        else {
          pending = Promise.resolve(live(request))
          if (cacheSeconds) {
            if (cache.size >= 1_000) cache.delete(cache.keys().next().value)
            cache.set(key, { value: pending, expires: Date.now() + cacheSeconds * 1_000 })
          }
        }
        const data = await pending.catch((error) => { cache.delete(key); throw error })
        response.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
        return response.json(envelope(data, source))
      } catch (error) {
        if (mode === 'false' || mode === 'live') throw error
        return response.json(envelope(await demo(request), 'demo', { fallbackReason: 'node-unavailable' }))
      }
    } catch (error) { next(error) }
  }

  app.get('/api/health', async (_request, response) => {
    try {
      const [chain, database] = await Promise.all([
        rpc.call('getblockchaininfo'),
        useDatabase ? databaseHealth(pool) : Promise.resolve(null),
      ])
      const healthy = !database || ['syncing', 'ready', 'idle'].includes(database.status)
      response.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded', chain: chain.chain, chainHeight: chain.blocks,
        database: database ? { status: database.status, indexedHeight: database.best_height, targetHeight: database.target_height, latencyMs: database.latencyMs } : null,
      })
    } catch (error) {
      response.status(503).json({ status: 'unavailable', error: error.message })
    }
  })

  app.get('/api/status', withData(
    () => useDatabase ? getIndexedStatus(pool, rpc) : getLiveStatus(rpc),
    () => mockStatus(),
    5))
  app.get('/api/blocks', withData(
    (request) => useDatabase
      ? getIndexedBlocks(pool, clamp(request.query.limit, 1, 30), request.query.start == null ? undefined : Number(request.query.start))
      : getLiveBlocks(rpc, clamp(request.query.limit, 1, 30), request.query.start == null ? undefined : Number(request.query.start)),
    (request) => mockBlocks(clamp(request.query.limit, 1, 30), request.query.start == null ? DEMO_HEIGHT : Number(request.query.start)),
    10))
  app.get('/api/block/:id', withData(
    (request) => useDatabase ? getIndexedBlock(pool, request.params.id) : getLiveBlock(rpc, request.params.id),
    (request) => mockBlock(request.params.id),
  ))
  app.get('/api/tx/:txid', withData(
    (request) => useDatabase ? getIndexedTransaction(pool, request.params.txid) : getLiveTransaction(rpc, request.params.txid),
    (request) => mockTransaction(request.params.txid),
  ))
  app.get('/api/address/:address', withData(
    (request) => useDatabase ? getIndexedAddress(pool, request.params.address) : getLiveAddress(rpc, request.params.address),
    (request) => mockAddress(request.params.address),
  ))
  app.get('/api/assets', withData(
    (request) => useDatabase
      ? getIndexedAssets(pool, String(request.query.q ?? ''), clamp(request.query.limit, 1, 100), Math.max(0, Number(request.query.offset) || 0))
      : getLiveAssets(rpc, String(request.query.q ?? ''), clamp(request.query.limit, 1, 100), Math.max(0, Number(request.query.offset) || 0)),
    (request) => {
      const query = String(request.query.q ?? '').toUpperCase()
      return mockAssets.filter((asset) => asset.name.includes(query)).slice(0, clamp(request.query.limit, 1, 100))
    },
    30))
  app.get('/api/asset/:name', withData(
    (request) => useDatabase ? getIndexedAsset(pool, request.params.name) : getLiveAsset(rpc, request.params.name),
    (request) => mockAsset(request.params.name),
  ))
  app.get('/api/search', async (request, response, next) => {
    try {
      const query = String(request.query.q ?? '').trim()
      if (!query || query.length > 128) throw new RpcError('Enter a valid block, transaction, address, or asset.', -8, 400)
      let result
      if (useDatabase) result = await searchIndexed(pool, query)
      else if (/^\d+$/.test(query)) result = { type: 'block', path: `/block/${query}` }
      else if (/^[a-fA-F0-9]{64}$/.test(query)) {
        if (mode === 'true' || mode === 'demo') {
          const isDemoBlock = mockBlocks(100).some((block) => block.hash === query)
          result = isDemoBlock ? { type: 'block', path: `/block/${query}` } : { type: 'transaction', path: `/tx/${query}` }
        }
        else {
          try { await rpc.call('getblockheader', [query]); result = { type: 'block', path: `/block/${query}` } }
          catch { result = { type: 'transaction', path: `/tx/${query}` } }
        }
      } else if (/^[Rr][1-9A-HJ-NP-Za-km-z]{24,35}$/.test(query)) result = { type: 'address', path: `/address/${query}` }
      else if (/^[A-Za-z0-9._#$!/~^-]{1,32}$/.test(query)) result = { type: 'asset', path: `/asset/${encodeURIComponent(query.toUpperCase())}` }
      else throw new RpcError('That search format is not recognized.', -8, 400)
      response.json(envelope(result, mode === 'true' || mode === 'demo' ? 'demo' : source))
    } catch (error) { next(error) }
  })

  app.get('/api/demo', (_, response) => response.json({
    height: DEMO_HEIGHT,
    blockHash: mockBlock(DEMO_HEIGHT).hash,
    txid: mockTransaction().txid,
    address: DEMO_ADDRESS,
    asset: 'RAVENSCOUT',
  }))

  if (process.env.NODE_ENV !== 'development') {
    app.use(express.static(path.join(projectRoot, 'dist'), { maxAge: '1h' }))
    app.get(/.*/, (_, response) => response.sendFile(path.join(projectRoot, 'dist', 'index.html')))
  }

  app.use((error, _request, response, _next) => {
    const status = Number(error.status) || (error.code === -5 ? 404 : 500)
    const safeStatus = status >= 400 && status < 600 ? status : 500
    response.status(safeStatus).json({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: safeStatus >= 500 ? 'Explorer data is temporarily unavailable.' : error.message,
      },
    })
  })
  return app
}

async function start() {
  const port = Number(process.env.PORT) || 3000
  const host = process.env.HOST ?? '0.0.0.0'
  if (process.env.EXPLORER_DATA_SOURCE === 'postgres' || databaseConfigured()) await migrate()
  createApp().listen(port, host, (error) => {
    if (error) {
      console.error(`Unable to start Ravencoin Explorer: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.log(`Ravencoin Explorer listening on http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port} (${process.env.EXPLORER_DATA_SOURCE ?? 'rpc'} mode)`)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start().catch((error) => { console.error('Explorer failed to start:', error); process.exitCode = 1 })
