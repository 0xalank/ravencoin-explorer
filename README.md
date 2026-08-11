# Ravencoin Community Explorer

A production-oriented, community-run Ravencoin explorer developed by [Dominant Strategies](https://dominantstrategies.io). It indexes the public chain into PostgreSQL for fast blocks, transactions, addresses, balances, UTXOs, assets, and asset-transfer queries.

> Independent community software. This project is not affiliated with, maintained by, or endorsed by the Ravencoin project, Ravencoin team, or Ravencoin Foundation.

## Architecture

```text
Ravencoin Core (RPC)
        │
        ▼
Checkpointed indexer ─────► PostgreSQL
                                 │
                                 ▼
                         Read-only API + UI
```

The interface follows a compact block-explorer layout with latest blocks and transactions, native asset discovery, address balances, and localized navigation. It also links to the [Quai SOAP dashboard](https://soap.qu.ai) and explains how compatible Ravencoin proof of work can participate in Quai merge mining without changing Ravencoin consensus.

The indexer reads verbose blocks in bounded batches and commits each batch transactionally. PostgreSQL stores:

- Canonical blocks and transactions
- Inputs, outputs, spent-output state, and transaction fees
- Address activity, cached balances, transaction history, and UTXOs
- Ravencoin asset metadata
- Asset issuance, reissuance, and transfers with source/destination addresses
- Durable sync state, progress, and errors

Only one indexer can run against a database at a time; a PostgreSQL advisory lock enforces that. Every new batch verifies its previous hash. When a reorg is detected, the worker locates the common ancestor, removes orphaned blocks transactionally, repairs affected address balances, refreshes affected assets, and resumes.

## Production quick start

1. Prepare a fully synchronized, non-pruned Ravencoin Core node.
2. Copy `.env.docker.example` to `.env` and set strong PostgreSQL and RPC passwords.
3. Make the node RPC reachable only by the Docker host/network.
4. Start the explorer stack:

```bash
cp .env.docker.example .env
docker compose up --build -d
docker compose logs -f indexer explorer
```

Open `http://127.0.0.1:3000`. PostgreSQL is bound to loopback by default. The indexer immediately imports the asset directory, then indexes blocks from genesis. The UI exposes index progress and never reports the database as fully synchronized until it reaches the node tip.

The Compose stack contains PostgreSQL, the indexer, and the explorer API/UI. Ravencoin Core remains external so an existing node and chain-state volume can be used without copying or rebuilding it.

### Self-contained VM deployment

`compose.remote.yaml` adds a wallet-disabled Ravencoin daemon built from a pinned Dominant Strategies source revision. It uses host bind mounts for chain and PostgreSQL data, publishes only the explorer UI and Ravencoin P2P port, and keeps RPC/PostgreSQL private to the Compose network.

```bash
cp .env.remote.example .env
# Set unique PostgreSQL and RPC passwords, then create raven.conf with matching RPC credentials.
docker compose --env-file .env -f compose.remote.yaml up --build -d
```

The default public bindings are `0.0.0.0:3102` for the explorer and `0.0.0.0:8767` for Ravencoin P2P. Port `8766` and PostgreSQL are intentionally not published. A restored node snapshot must never include `wallet.dat`; this deployment compiles Core with wallet support disabled.

## Ravencoin Core configuration

The PostgreSQL indexer requires complete block data and the asset directory:

```ini
server=1
prune=0
assetindex=1
rpcuser=ravencoinrpc
rpcpassword=replace-with-a-long-random-secret
```

If Core runs directly on the Docker host, configure `rpcbind` and `rpcallowip` narrowly for the Docker bridge subnet and enforce the same boundary with the host firewall. Never expose port `8766` to the public internet.

The legacy direct-RPC mode additionally needs:

```ini
txindex=1
addressindex=1
```

Enabling indexes on existing state may require restarting Core with `-reindex`.

## Development

The frontend can still run against clearly labeled demo data without PostgreSQL:

```bash
pnpm install
EXPLORER_DEMO_MODE=true pnpm dev
```

For indexed local development, start PostgreSQL and configure `DATABASE_URL`, `RAVEN_RPC_*`, and `EXPLORER_DATA_SOURCE=postgres` in `.env`:

```bash
pnpm db:migrate
pnpm indexer
pnpm dev
```

## Commands

```bash
pnpm dev             # frontend and API development servers
pnpm db:migrate      # idempotently create/update the PostgreSQL schema
pnpm indexer         # run the checkpointed indexer
pnpm test            # normalization and indexer utility tests
pnpm build           # type-check and production build
pnpm check           # tests plus production build
pnpm start           # serve the production API and compiled UI
pnpm compose:up      # build and start the production stack
pnpm compose:logs    # follow explorer and indexer logs
pnpm compose:down    # stop the stack without deleting PostgreSQL data
```

## API

All public endpoints are read-only and rate-limited:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Node, database, and indexer readiness |
| `GET /api/status` | Network statistics and index progress |
| `GET /api/blocks` | Indexed blocks |
| `GET /api/transactions` | Latest indexed transactions |
| `GET /api/block/:heightOrHash` | Block details and transactions |
| `GET /api/tx/:txid` | Inputs, outputs, assets, and fees |
| `GET /api/address/:address` | Balances, assets, UTXOs, and recent history |
| `GET /api/assets` | Searchable asset directory |
| `GET /api/asset/:name` | Asset metadata and recent transfers |
| `GET /api/search?q=...` | Indexed search classification |

Successful responses include `meta.source`: `indexed`, `live`, or `demo`. Production should use `EXPLORER_DATA_SOURCE=postgres` and `EXPLORER_DEMO_MODE=false` so infrastructure failures are never replaced with synthetic data.

## Operations

- The indexer resumes from `sync_state.best_height` after restarts.
- `INDEXER_BATCH_SIZE` controls backfill transaction size. Start with `20`; increase only after observing node and database memory.
- `INDEXER_FETCH_CONCURRENCY` controls ordered parallel `getblock` RPC batches. Start with `1` locally; `4` is appropriate when Ravencoin Core has spare CPU and RPC workers.
- `/api/health` returns `503` when the node/database is unavailable or the indexer is in an error state.
- Keep regular PostgreSQL backups. The database can always be rebuilt from genesis, but restoration is much faster than a full reindex.
- Monitor indexer height versus target height, `last_error`, PostgreSQL disk usage, and API latency.
- The `explorer-postgres` Docker volume is intentionally preserved by `docker compose down`. Adding `--volumes` deletes the entire explorer index.
