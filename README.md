# Raven Scout

A fast, community-run Ravencoin explorer developed by [Dominant Strategies](https://dominantstrategies.io). Raven Scout is intentionally focused on the essentials: network health, blocks, transactions, addresses and balances, UTXOs, and Ravencoin assets.

> Raven Scout is an independent community project. It is not affiliated with, maintained by, or endorsed by the Ravencoin project, Ravencoin team, or Ravencoin Foundation.

## What is included

- Responsive overview with height, hashrate, mempool, peer count, and recent blocks
- Global lookup for block heights/hashes, transaction IDs, Ravencoin addresses, and asset names
- Block and transaction detail views
- Address balances, asset balances, recent transactions, and UTXOs
- Ravencoin asset directory and metadata views
- English, Korean, Simplified Chinese, Japanese, and Spanish UI
- Read-only server proxy; RPC credentials are never sent to the browser
- Clearly labeled demo fallback so frontend work can continue before a node is available

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:5173`. With the default `EXPLORER_DEMO_MODE=auto`, the app uses a configured Ravencoin node when available and falls back to representative demo data when it is not.

## Connect Ravencoin Core

The address and asset views depend on indexes provided by the Dominant Strategies `Ravencoin-Public` node. Add equivalent settings to the node's `raven.conf`, use a strong unique RPC password, and keep RPC bound to a trusted interface:

```ini
server=1
txindex=1
addressindex=1
assetindex=1
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcuser=ravencoinrpc
rpcpassword=replace-with-a-long-random-secret
```

Then configure the explorer:

```ini
RAVEN_RPC_URL=http://127.0.0.1:8766
RAVEN_RPC_USER=ravencoinrpc
RAVEN_RPC_PASSWORD=replace-with-a-long-random-secret
EXPLORER_DEMO_MODE=false
PORT=3000
```

Restarting a node after enabling indexes can require a reindex. Do not expose the node's JSON-RPC port publicly; expose only the explorer HTTP server behind your normal TLS reverse proxy.

## Commands

```bash
pnpm dev       # frontend + API with live reload
pnpm test      # server normalization tests
pnpm build     # type-check and production build
pnpm check     # tests + build
pnpm start     # serve the built app and API on PORT
```

## API surface

All endpoints are read-only:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | Chain, network, mining, and mempool status |
| `GET /api/blocks` | Paginated recent blocks |
| `GET /api/block/:heightOrHash` | Block details and transactions |
| `GET /api/tx/:txid` | Transaction details |
| `GET /api/address/:address` | RVN/asset balances, UTXOs, and recent transactions |
| `GET /api/assets` | Filtered asset directory |
| `GET /api/asset/:name` | Asset metadata |
| `GET /api/search?q=...` | Search classification and destination |

Every successful response includes `meta.source`, which is either `live` or `demo`. The UI uses this to ensure fallback data can never be mistaken for live chain state.

## Production

Build once and run the single Node process:

```bash
pnpm install --frozen-lockfile
pnpm build
NODE_ENV=production pnpm start
```

The server serves the compiled frontend and `/api` from the same origin. Set `EXPLORER_DEMO_MODE=false` in production if the site should return an error instead of preview data while the node is unavailable.
