# Ravencoin txindex snapshots

Ravencoin Core's `txindex` is an embedded LevelDB index in `blocks/index`; it is
not PostgreSQL. This workflow runs a dedicated node outside the explorer,
builds the index from local raw block files, and publishes a complete,
bootable datadir snapshot. The explorer node and explorer PostgreSQL database
remain independent.

The pinned Core version requires a full one-time `-reindex` when changing from
`txindex=0` to `txindex=1`. `-reindex-chainstate` is not sufficient. Never put
`reindex=1` in the permanent configuration.

## Layout and first build

Use storage with enough room for the live datadir, staging copy, compressed
archive, and verification extraction. On the production VM:

```text
/mnt/combined/soap-quai-explorer/ravencoin-txindex/
├── data/       dedicated live Core datadir
├── snapshots/ public, immutable archives and metadata
└── staging/    temporary consistent-copy workspace
```

Initialize private configuration and all bind directories before starting
Compose. The initializer generates unique RPC credentials. The Compose file
does not publish RPC or a P2P listener, and the download service binds only to
loopback until a reverse proxy is deliberately configured.

```bash
pnpm ops:txindex:init

set -a
. ./.env.txindex
set +a

bash scripts/ops/txindex-seed.sh \
  /home/quai/ravencoin-explorer/ravencoin-data \
  /mnt/combined/soap-quai-explorer/ravencoin-txindex/data

pnpm ops:txindex:start-reindex
```

The seed script verifies an unpruned, contiguous block-file sequence, copies
every closed `blk*.dat`, and omits the live final file.
The dedicated node rebuilds block index, chainstate, asset state, undo data, and
txindex from those local files, then downloads the small missing tail. The start
script passes `-reindex` only until Core confirms it has persisted its internal
reindex state, then immediately recreates the container without the explicit
flag. Subsequent container or host restarts safely resume rather than wiping
and restarting the databases.

Check progress and the definitive historical-transaction probe:

```bash
COMPOSE_ENV_FILE=.env.txindex pnpm ops:txindex:status
```

The block-1 transaction appears early during a rebuild, so it is not sufficient
by itself. Wait for Core to log `Reindexing finished`, for the builder to be on
the explorer node's canonical tip, then finalize the build:

```bash
COMPOSE_ENV_FILE=.env.txindex pnpm ops:txindex:finalize
```

Finalization creates a durable readiness marker, recreates the node without
`-reindex`, and repeats the probe after a normal restart. This version of
Ravencoin Core does not expose Bitcoin Core's `getindexinfo` RPC, so the probe
retrieves a fully spent transaction from block 1 without supplying its block
hash. That request fails on a non-txindex node.

## Publish a consistent snapshot

Load the path variables for the host-side snapshot script, then run it:

```bash
set -a
. ./.env.txindex
set +a
pnpm ops:txindex:snapshot
```

The script refuses pruned, incomplete, stale, unverified, low-disk, or
over-retention nodes. It makes a live staging copy, gracefully stops only the
dedicated txindex node for the final rsync, restarts it immediately, then boots
the exact staged copy offline. Only after its height, canonical hash, chainwork,
Core version and historical txindex probe pass does it create and atomically
publish a release directory containing:

- `ravencoin-mainnet-txindex-H<height>-<UTC>.tar.zst`
- a SHA-256 sidecar;
- a versioned manifest with height, hash, chainwork, Core version and flags;
- `latest.json` for clients.

The static service defaults to `127.0.0.1:3103` for deliberate routing through
a firewall/reverse proxy. RPC is never exposed. Versioned files support HTTP
range requests, global/per-client connection limits, bandwidth limiting, and
immutable caching; `latest.json` is never cached. Prefer replicating releases
to object storage/CDN rather than serving large downloads from the database VM.
Start it only after the first verified release exists:

```bash
docker compose --project-name ravencoin-txindex --env-file .env.txindex \
  -f compose.txindex.yaml up -d snapshot-server
```

Run an extraction and isolated boot drill before announcing the first release:

```bash
TXINDEX_VERIFY_DIR=/mnt/combined/soap-quai-explorer/ravencoin-txindex/staging \
  bash scripts/ops/verify-txindex-snapshot.sh \
  /path/to/releases/<release>/ravencoin-mainnet-txindex-H<height>-<UTC>.tar.zst --boot
```

Recipients must configure `txindex=1`, `assetindex=1`, and `prune=0`. The
archive intentionally excludes RPC credentials, cookies, wallets, logs, peer
state, PID/lock files, and onion keys. Never publish `blocks/index` by itself;
it is only valid with the exact matching raw block files.

Same-machine publication is distribution, not disaster recovery. The publisher
keeps at most four local releases by default and never deletes one
automatically. Replicate the archive, checksum, and manifest to versioned
off-host object storage; remove old local releases deliberately only after
verifying that replication.
