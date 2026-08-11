import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min))

export function createApp(options = {}) {
  const app = express()
  const rpc = options.rpc ?? new RavenRpc()
  const configuredMode = options.demoMode ?? process.env.EXPLORER_DEMO_MODE ?? 'auto'
  const mode = String(configuredMode).toLowerCase()

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

  const envelope = (data, source, extra = {}) => ({
    data,
    meta: { source, network: 'main', updatedAt: new Date().toISOString(), ...extra },
  })

  const withData = (live, demo) => async (request, response, next) => {
    try {
      if (mode === 'true' || mode === 'demo') return response.json(envelope(await demo(request), 'demo'))
      try {
        const data = await live(request)
        response.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
        return response.json(envelope(data, 'live'))
      } catch (error) {
        if (mode === 'false' || mode === 'live') throw error
        return response.json(envelope(await demo(request), 'demo', { fallbackReason: 'node-unavailable' }))
      }
    } catch (error) { next(error) }
  }

  app.get('/api/status', withData(
    () => getLiveStatus(rpc),
    () => mockStatus(),
  ))
  app.get('/api/blocks', withData(
    (request) => getLiveBlocks(rpc, clamp(request.query.limit, 1, 30), request.query.start == null ? undefined : Number(request.query.start)),
    (request) => mockBlocks(clamp(request.query.limit, 1, 30), request.query.start == null ? DEMO_HEIGHT : Number(request.query.start)),
  ))
  app.get('/api/block/:id', withData(
    (request) => getLiveBlock(rpc, request.params.id),
    (request) => mockBlock(request.params.id),
  ))
  app.get('/api/tx/:txid', withData(
    (request) => getLiveTransaction(rpc, request.params.txid),
    (request) => mockTransaction(request.params.txid),
  ))
  app.get('/api/address/:address', withData(
    (request) => getLiveAddress(rpc, request.params.address),
    (request) => mockAddress(request.params.address),
  ))
  app.get('/api/assets', withData(
    (request) => getLiveAssets(rpc, String(request.query.q ?? ''), clamp(request.query.limit, 1, 100), Math.max(0, Number(request.query.offset) || 0)),
    (request) => {
      const query = String(request.query.q ?? '').toUpperCase()
      return mockAssets.filter((asset) => asset.name.includes(query)).slice(0, clamp(request.query.limit, 1, 100))
    },
  ))
  app.get('/api/asset/:name', withData(
    (request) => getLiveAsset(rpc, request.params.name),
    (request) => mockAsset(request.params.name),
  ))
  app.get('/api/search', async (request, response, next) => {
    try {
      const query = String(request.query.q ?? '').trim()
      if (!query || query.length > 128) throw new RpcError('Enter a valid block, transaction, address, or asset.', -8, 400)
      let result
      if (/^\d+$/.test(query)) result = { type: 'block', path: `/block/${query}` }
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
      response.json(envelope(result, mode === 'true' || mode === 'demo' ? 'demo' : 'live'))
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000
  const host = process.env.HOST ?? '0.0.0.0'
  createApp().listen(port, host, (error) => {
    if (error) {
      console.error(`Unable to start Raven Scout: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.log(`Raven Scout listening on http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`)
  })
}
