# Explorer operations

These commands are separate from the API/indexer. Reconciliation and monitoring are read-only. Snapshot restore is guarded: it requires explicit confirmation, rejects the active Compose database, and requires an empty target.

## Fork reconciliation artifacts

The public incident artifacts live in `public/data` and are copied into the production `dist/data` directory by Vite. Before a release, run `pnpm check`, compare each CSV to its checked-in `.sha256` sidecar, and load `/api/reversals` once; the loader rejects mismatched manifest digests, malformed rows, invalid Ravencoin Base58Check addresses, inconsistent counts/values, or broken direct-spend evidence.

Canonical input/output and direct-spend companions are reproducible with the bounded SQL under `scripts/ops`. Populate `/tmp/rvn-confirmed-txids.txt` with the 2,688 confirmed txids before running them in PostgreSQL. The queries use primary-key-leading txid lookups and do not scan the full address-activity ledger. Keep each published dataset version immutable; update its manifest, checksums, verification height/hash, and caveats together.

Production smoke checks must cover:

```bash
curl -fsS https://rvn.quai.network/api/reversals?limit=1
curl -fsSI https://rvn.quai.network/data/rvn-reversed-transactions.csv
curl -fsS -H 'Range: bytes=0-127' https://rvn.quai.network/data/rvn-reversed-transactions.csv
curl -fsS 'https://rvn.quai.network/api/reversals.csv?status=CONFIRMED' -o /tmp/rvn-confirmed-reconciliation.csv
```

The direct-spend export is intentionally one hop. Do not replace it with an unbounded recursive query on a public request path. Regenerate a deeper graph offline, cap depth/nodes, version it separately, and retain the multi-input attribution warning.

## RPC reconciliation

After the processed tip crosses Ravencoin asset activation at block `435456`, run:

```bash
docker compose --env-file .env -f compose.remote.yaml exec -T explorer \
  node scripts/ops/reconcile-rpc.mjs
```

This works with production's `assetindex=1`; it does not require `addressindex` or `txindex`. It obtains canonical hashes with `getblockhash(height)`, loads verbosity-2 blocks, and checks exact atomic values for:

- every raw output in the sampled blocks;
- receive-side address activity;
- every sampled asset output/transfer, its type, and destinations;
- recent indexed transfers against their canonical blocks; and
- sampled cached balances against the complete indexed activity ledger through the processed checkpoint.

During catch-up, Core's live address balance is ahead of the explorer. The tool therefore does not incorrectly compare partial indexed balances with live-tip balances. Canonical RPC blocks anchor sampled events; the separate ledger roll-up validates the balance cache. Any mismatch exits nonzero. Before asset activation, it reports that the audit is not applicable and exits successfully.

```dotenv
RECONCILE_BLOCK_SAMPLES=8
RECONCILE_BALANCE_SAMPLES=6
RECONCILE_TRANSFER_SAMPLES=16
RECONCILE_RPC_BATCH_SIZE=4
RECONCILE_RPC_TIMEOUT_MS=120000
RECONCILE_DATABASE_TIMEOUT_MS=120000
RECONCILE_REQUIRE_ASSET_SAMPLES=true
RECONCILE_ASSET_GRACE_BLOCKS=1440
```

Run this daily during asset-era catch-up and after indexer, schema, reorg, or restoration work.

## Monitoring

The runtime image includes the operational scripts, and the Compose stack preserves monitor state in `explorer-ops-state`. A five-minute cron check is:

```cron
*/5 * * * * cd /home/quai/ravencoin-explorer/app && docker compose --env-file .env -f compose.remote.yaml exec -T explorer node scripts/ops/monitor.mjs >> /home/quai/ravencoin-explorer/logs/monitor.log 2>&1
```

It exits nonzero when health fails, the processed checkpoint is stale while behind target, PostgreSQL reports an indexer error, or disk headroom crosses either threshold. It also reports cumulative PostgreSQL temporary I/O and its increase since the previous run.

```dotenv
INDEXER_STALE_SECONDS=600
MONITOR_HEALTH_URL=http://127.0.0.1:3000/api/health
MONITOR_DISK_PATH=/
MONITOR_MIN_DISK_FREE_BYTES=107374182400
MONITOR_MIN_DISK_FREE_PERCENT=10
MONITOR_MAX_TEMP_BYTES_PER_INTERVAL=1073741824
MONITOR_STATE_FILE=/app/ops-state/monitor.json
```

With `INDEXER_WORK_MEM=512MB`, the asset-era production sample wrote about 13 MiB per 500-block batch, comfortably below the example 1 GiB/five-minute alert. Re-baseline after changing batch size, memory, or analytics queries; set `MONITOR_MAX_TEMP_BYTES_PER_INTERVAL=0` only while intentionally measuring. `MONITOR_DISK_PATH=/` measures the container's backing filesystem; add a host-level filesystem alert if `POSTGRES_DATA_DIR` is on a separate mount. Connect cron's nonzero exit to cron mail, a systemd `OnFailure` unit, or an external monitoring agent—a log file alone is not an alert.

## PostgreSQL snapshots

Custom-format `pg_dump` archives are transactionally consistent. To avoid adding read/compression load during catch-up, snapshots refuse to run unless `sync_state.status` is `ready`. `SNAPSHOT_ALLOW_SYNCING=true` is an explicit emergency override.

```bash
COMPOSE_FILE=compose.remote.yaml COMPOSE_ENV_FILE=.env \
  bash scripts/ops/postgres-snapshot.sh /home/quai/ravencoin-explorer/backups/postgres

bash scripts/ops/verify-postgres-snapshot.sh \
  /home/quai/ravencoin-explorer/backups/postgres/ravencoin-explorer-YYYYMMDDTHHMMSSZ.dump
```

Each run creates a custom archive and SHA-256 sidecar, refuses overwrites, verifies the archive catalog, and never performs retention deletion. After catch-up, schedule a weekly snapshot during a low-traffic period.

Snapshot settings are host-shell variables, not Compose container variables. Prefix or export them on the command invocation; the scripts intentionally do not source `.env`:

```bash
SNAPSHOT_COMPRESSION=6 SNAPSHOT_ALLOW_SYNCING=false \
  bash scripts/ops/postgres-snapshot.sh /path/to/backups
```

A same-server snapshot is a recovery convenience, not a disaster backup. Immediately replicate the archive and checksum off-host, preferably to encrypted, versioned object storage. Monitor replication success. A reasonable starting policy is four weekly and six monthly off-host archives. Keep encrypted configuration separately; never bundle `.env`, RPC credentials, or `raven.conf` into the database archive.

### Restore drill

Create a separate empty database:

```bash
docker compose --env-file .env -f compose.remote.yaml exec -T postgres sh -eu -c \
  'exec createdb --username="$POSTGRES_USER" rvn_restore_drill'
```

Restore with the target name and explicit confirmation:

```bash
COMPOSE_FILE=compose.remote.yaml COMPOSE_ENV_FILE=.env \
RESTORE_DATABASE_NAME=rvn_restore_drill \
  bash scripts/ops/restore-postgres-snapshot.sh /path/to/ravencoin-explorer-YYYYMMDDTHHMMSSZ.dump \
  --confirm-empty-target
```

The command requires and verifies the archive checksum, uses a PostgreSQL client compatible with the archive, refuses `POSTGRES_DB` and reserved databases, confirms zero user schema objects, and restores in one transaction without `--clean` or drops. A trusted legacy archive without a sidecar requires the explicit `SNAPSHOT_ALLOW_MISSING_CHECKSUM=true` override. Afterward, point a disposable explorer at the drill database, run migrations, reconciliation, API smoke tests, and checkpoint checks. Drill quarterly and after PostgreSQL major-version or backup-tool changes.

For non-Compose PostgreSQL, use `BACKUP_DATABASE_URL` or `RESTORE_DATABASE_URL`; local PostgreSQL client tools are required. Promotion of a restored database is a separate maintenance operation: stop writers, retain the old database, and validate before switching traffic.
