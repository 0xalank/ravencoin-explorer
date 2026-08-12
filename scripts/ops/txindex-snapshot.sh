#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/ops/txindex-snapshot.sh

Creates a consistent Ravencoin Core txindex snapshot. It live-copies the
dedicated node, cleanly stops only that node for a final rsync, restarts it,
boots the staged copy offline, derives metadata from that exact copy, then
publishes an archive directory and latest.json atomically.

Optional: COMPOSE_FILE, COMPOSE_ENV_FILE, COMPOSE_PROJECT_NAME,
TXINDEX_ZSTD_LEVEL, TXINDEX_ZSTD_THREADS, TXINDEX_BOOT_TIMEOUT_SECONDS.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi
if (( $# > 0 )); then usage >&2; exit 2; fi

for command_name in docker jq realpath rsync sha256sum stat tar zstd; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done

compose_file="${COMPOSE_FILE:-compose.txindex.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env.txindex}"
compose_project="${COMPOSE_PROJECT_NAME:-ravencoin-txindex}"
if [[ -f "$compose_env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$compose_env_file"
  set +a
fi

data_dir="${TXINDEX_DATA_DIR:?TXINDEX_DATA_DIR is required}"
staging_root="${TXINDEX_STAGING_DIR:?TXINDEX_STAGING_DIR is required}"
snapshot_dir="${TXINDEX_SNAPSHOT_DIR:?TXINDEX_SNAPSHOT_DIR is required}"
allowed_root="${TXINDEX_ALLOWED_ROOT:?TXINDEX_ALLOWED_ROOT is required}"
reference_container="${TXINDEX_REFERENCE_CONTAINER:-ravencoin-explorer-ravend-1}"
maximum_lag="${TXINDEX_MAX_SNAPSHOT_LAG:-20}"
minimum_free_bytes="${TXINDEX_MIN_FREE_BYTES:-214748364800}"
maximum_snapshots="${TXINDEX_MAX_LOCAL_SNAPSHOTS:-4}"
zstd_level="${TXINDEX_ZSTD_LEVEL:-6}"
zstd_threads="${TXINDEX_ZSTD_THREADS:-8}"
boot_timeout="${TXINDEX_BOOT_TIMEOUT_SECONDS:-600}"
probe_txid="${TXINDEX_PROBE_TXID:-3480049256d63cd936a387874fc437912575f782259badac7a09054b94b3a6d8}"
expected_block="${TXINDEX_PROBE_BLOCK:-00000058bcc33dea08b53691edb9e49a9eb8bac36a0db17eb5a7588860b1f590}"

for numeric in maximum_lag minimum_free_bytes maximum_snapshots zstd_threads boot_timeout; do
  [[ "${!numeric}" =~ ^[0-9]+$ ]] || { echo "$numeric must be a non-negative integer." >&2; exit 2; }
done
[[ "$zstd_level" =~ ^([1-9]|1[0-9])$ ]] || { echo "TXINDEX_ZSTD_LEVEL must be 1 through 19." >&2; exit 2; }
(( maximum_snapshots > 0 && zstd_threads > 0 && boot_timeout > 0 )) || { echo "Snapshot count, zstd threads, and boot timeout must be positive." >&2; exit 2; }

allowed_root="$(realpath -m -- "$allowed_root")"
data_dir="$(realpath -m -- "$data_dir")"
staging_root="$(realpath -m -- "$staging_root")"
snapshot_dir="$(realpath -m -- "$snapshot_dir")"
for path in "$data_dir" "$staging_root" "$snapshot_dir"; do
  case "$path" in "$allowed_root"/*) ;; *) echo "Path escapes allowed root: $path" >&2; exit 1 ;; esac
done
paths=("$data_dir" "$staging_root" "$snapshot_dir")
if [[ "$data_dir" == "$staging_root" || "$data_dir" == "$snapshot_dir" || "$staging_root" == "$snapshot_dir" ]]; then
  echo "Txindex data, staging, and snapshot paths must be distinct." >&2
  exit 1
fi
for left in "${paths[@]}"; do
  for right in "${paths[@]}"; do
    [[ "$left" == "$right" ]] && continue
    case "$right" in "$left"/*) echo "Txindex paths must not overlap: $left and $right" >&2; exit 1 ;; esac
  done
done

[[ -d "$data_dir/blocks/index" && -d "$data_dir/chainstate" ]] || { echo "Incomplete txindex datadir: $data_dir" >&2; exit 1; }
mkdir -p -- "$staging_root" "$snapshot_dir/releases"
[[ "$(stat -c '%d' "$data_dir")" == "$(stat -c '%d' "$staging_root")" && "$(stat -c '%d' "$staging_root")" == "$(stat -c '%d' "$snapshot_dir")" ]] || {
  echo "Live, staging, and snapshot paths must share one filesystem for atomic publication." >&2
  exit 1
}

existing_snapshots="$(find "$snapshot_dir/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' | wc -l)"
if (( existing_snapshots >= maximum_snapshots )); then
  echo "Local snapshot limit ($maximum_snapshots) reached. Replicate and remove an old release deliberately before continuing." >&2
  exit 1
fi
data_bytes="$(du -sb -- "$data_dir" | awk '{print $1}')"
available_bytes="$(df --output=avail --block-size=1 "$staging_root" | tail -n 1 | tr -d '[:space:]')"
required_bytes="$((data_bytes * 2 + minimum_free_bytes))"
if (( available_bytes < required_bytes )); then
  echo "Insufficient free space: need $required_bytes bytes for staging, worst-case archive, and reserve; have $available_bytes." >&2
  exit 1
fi

compose=(docker compose --project-name "$compose_project")
compose+=(--env-file "$compose_env_file" -f "$compose_file")
builder_id="$("${compose[@]}" ps -q ravend-txindex)"
[[ -n "$builder_id" ]] || { echo "The dedicated txindex container is not running." >&2; exit 1; }
mounted_data="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$builder_id")"
mounted_data="$(realpath -m -- "$mounted_data")"
[[ "$mounted_data" == "$data_dir" ]] || { echo "Configured datadir ($data_dir) differs from container mount ($mounted_data)." >&2; exit 1; }
image_id="$(docker inspect --format '{{.Image}}' "$builder_id")"
source_commit="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id" 2>/dev/null || true)"
source_commit="${source_commit:-${RAVEN_COMMIT:-unknown}}"

if ! "${compose[@]}" exec -T ravend-txindex test -f /data/.txindex-ready; then
  echo "Refusing snapshot before txindex-finalize.sh has verified the rebuild and normal restart." >&2
  exit 1
fi

stage="$(mktemp -d "$staging_root/.txindex-stage.XXXXXX")"
stage_data="$stage/ravencoin-mainnet"
mkdir -p -- "$stage_data"
node_stopped=false
verify_container=''
release_partial=''

safe_remove_stage() {
  case "$stage" in "$staging_root"/.txindex-stage.*) rm -rf -- "$stage" ;; *) echo "Refusing unsafe staging cleanup: $stage" >&2 ;; esac
}
cleanup() {
  if [[ -n "$verify_container" ]]; then docker stop -t 30 "$verify_container" >/dev/null 2>&1 || true; docker rm -f "$verify_container" >/dev/null 2>&1 || true; fi
  if [[ "$node_stopped" == true ]]; then "${compose[@]}" start ravend-txindex >/dev/null || true; fi
  if [[ -n "$release_partial" && -d "$release_partial" ]]; then
    case "$release_partial" in "$snapshot_dir"/releases/.*.partial) rm -rf -- "$release_partial" ;; esac
  fi
  [[ ! -d "$stage" ]] || safe_remove_stage
}
trap cleanup EXIT INT TERM

rsync_options=(
  --archive --numeric-ids --delete --delete-excluded
  --exclude=/.cookie --exclude=/.lock --exclude=/.txindex-ready
  --exclude=/.txindex-reindex-started --exclude=/.txindex-reindex-complete
  --exclude=/banlist.dat --exclude=/db.log --exclude='/debug.log*'
  --exclude=/fee_estimates.dat --exclude=/mempool.dat
  --exclude=/onion_private_key --exclude=/onion_v3_private_key
  --exclude=/peers.dat --exclude=/raven.conf --exclude=/ravend.pid
  --exclude=/wallet.dat --exclude=/wallets/ --exclude='LOCK'
)

echo "Copying the live txindex datadir into staging."
set +e
rsync "${rsync_options[@]}" "$data_dir/" "$stage_data/"
first_rsync_status=$?
set -e
if (( first_rsync_status != 0 && first_rsync_status != 24 )); then
  echo "Initial rsync failed with status $first_rsync_status." >&2
  exit "$first_rsync_status"
fi

echo "Stopping only the dedicated txindex node for the final consistent pass."
"${compose[@]}" stop -t 300 ravend-txindex
node_stopped=true
exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$builder_id")"
[[ "$exit_code" == 0 ]] || { echo "Dedicated node did not stop cleanly (exit $exit_code); refusing snapshot." >&2; exit 1; }
rsync "${rsync_options[@]}" "$data_dir/" "$stage_data/"
"${compose[@]}" start ravend-txindex >/dev/null
node_stopped=false

for required_dir in blocks/index chainstate assets messages myrestricted rewards; do
  [[ -d "$stage_data/$required_dir" ]] || { echo "Staged snapshot is missing $required_dir." >&2; exit 1; }
done
if find "$stage_data" -type f \( -name 'wallet.dat' -o -name '.cookie' -o -name 'raven.conf' \) -print -quit | grep -q .; then
  echo "Refusing snapshot containing credentials or wallet data." >&2
  exit 1
fi

verify_config="$stage/verify-raven.conf"
printf '%s\n' \
  'server=1' 'prune=0' 'txindex=1' 'assetindex=1' 'listen=0' 'discover=0' \
  'rpcbind=127.0.0.1' 'rpcallowip=127.0.0.1/32' \
  'rpcuser=snapshotverify' 'rpcpassword=snapshotverify-isolated' >"$verify_config"
verify_container="rvn-txindex-stage-$$"
docker run -d --name "$verify_container" --network none --memory 24g \
  -v "$stage_data:/data" -v "$verify_config:/etc/ravencoin/raven.conf:ro" \
  "$image_id" -datadir=/data -conf=/etc/ravencoin/raven.conf -onlynet=ipv4 >/dev/null

ready=false
for _ in $(seq 1 "$boot_timeout"); do
  if docker exec "$verify_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo "Staged snapshot did not boot within $boot_timeout seconds." >&2; exit 1; }

chain_info="$(docker exec "$verify_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo)"
network_info="$(docker exec "$verify_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getnetworkinfo)"
height="$(printf '%s' "$chain_info" | jq -r '.blocks')"
headers="$(printf '%s' "$chain_info" | jq -r '.headers')"
best_hash="$(printf '%s' "$chain_info" | jq -r '.bestblockhash')"
chainwork="$(printf '%s' "$chain_info" | jq -r '.chainwork')"
chain="$(printf '%s' "$chain_info" | jq -r '.chain')"
pruned="$(printf '%s' "$chain_info" | jq -r '.pruned')"
version="$(printf '%s' "$network_info" | jq -r '.subversion')"
[[ "$height" =~ ^[0-9]+$ && "$headers" == "$height" && "$chain" == main && "$pruned" == false ]] || {
  echo "Staged node is incomplete or not unpruned mainnet (blocks=$height headers=$headers chain=$chain pruned=$pruned)." >&2
  exit 1
}
transaction="$(docker exec "$verify_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getrawtransaction "$probe_txid" true)"
actual_block="$(printf '%s' "$transaction" | jq -r '.blockhash // empty')"
[[ "$actual_block" == "$expected_block" ]] || { echo "Staged txindex probe failed." >&2; exit 1; }
reference_height="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockcount)"
canonical_hash="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockhash "$height")"
lag="$((reference_height - height))"
[[ "$best_hash" == "$canonical_hash" && "$lag" -ge 0 && "$lag" -le "$maximum_lag" ]] || {
  echo "Staged snapshot is not at a recent canonical tip (height=$height reference=$reference_height lag=$lag)." >&2
  exit 1
}

docker stop -t 300 "$verify_container" >/dev/null
verify_exit="$(docker inspect --format '{{.State.ExitCode}}' "$verify_container")"
[[ "$verify_exit" == 0 ]] || { echo "Staged verification node did not stop cleanly (exit $verify_exit)." >&2; exit 1; }
docker rm "$verify_container" >/dev/null
verify_container=''

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
base="ravencoin-mainnet-txindex-H${height}-${timestamp}"
archive_name="$base.tar.zst"
manifest_name="$base.manifest.json"
checksum_name="$archive_name.sha256"
release_partial="$snapshot_dir/releases/.$base.partial"
release_final="$snapshot_dir/releases/$base"
[[ ! -e "$release_partial" && ! -e "$release_final" ]] || { echo "Release already exists: $base" >&2; exit 1; }
mkdir -- "$release_partial"

temporary_archive="$stage/$archive_name.partial"
tar -C "$stage" -cf - ravencoin-mainnet | zstd -T"$zstd_threads" -"$zstd_level" -o "$temporary_archive"
zstd -q -t "$temporary_archive"
tar --use-compress-program=unzstd -tf "$temporary_archive" >/dev/null
mv -- "$temporary_archive" "$release_partial/$archive_name"

archive="$release_partial/$archive_name"
archive_bytes="$(stat -c '%s' "$archive")"
datadir_bytes="$(du -sb -- "$stage_data" | awk '{print $1}')"
archive_sha256="$(sha256sum "$archive" | awk '{print $1}')"
printf '%s  %s\n' "$archive_sha256" "$archive_name" >"$release_partial/$checksum_name"
jq -n \
  --arg format "ravencoin-core-datadir-tar-zstd-v1" --arg archive "$archive_name" \
  --arg sha256 "$archive_sha256" --arg created_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg core_version "$version" --arg source_commit "$source_commit" --arg image_id "$image_id" \
  --argjson height "$height" --arg best_block_hash "$best_hash" --arg chainwork "$chainwork" \
  --argjson archive_bytes "$archive_bytes" --argjson datadir_bytes "$datadir_bytes" \
  --arg probe_txid "$probe_txid" --arg probe_block_hash "$expected_block" \
  '{format:$format,archive:$archive,sha256:$sha256,archiveBytes:$archive_bytes,datadirBytes:$datadir_bytes,createdAt:$created_at,network:"main",coreVersion:$core_version,sourceCommit:$source_commit,imageId:$image_id,height:$height,bestBlockHash:$best_block_hash,chainwork:$chainwork,txindex:true,assetindex:true,pruned:false,probe:{txid:$probe_txid,blockHash:$probe_block_hash}}' \
  >"$release_partial/$manifest_name"
chmod 0644 -- "$release_partial"/*
mv -- "$release_partial" "$release_final"
release_partial=''

latest_tmp="$snapshot_dir/.latest.json.partial"
jq -n \
  --arg release "releases/$base" --arg archive "releases/$base/$archive_name" \
  --arg checksum "releases/$base/$checksum_name" --arg manifest "releases/$base/$manifest_name" \
  --arg sha256 "$archive_sha256" --arg created_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --argjson height "$height" --argjson archive_bytes "$archive_bytes" \
  '{release:$release,archive:$archive,checksum:$checksum,manifest:$manifest,sha256:$sha256,height:$height,archiveBytes:$archive_bytes,createdAt:$created_at}' \
  >"$latest_tmp"
mv -- "$latest_tmp" "$snapshot_dir/latest.json"
chmod 0644 -- "$snapshot_dir/latest.json"

safe_remove_stage
trap - EXIT INT TERM
echo "Published txindex snapshot release: $release_final"
echo "Height: $height"
echo "SHA-256: $archive_sha256"
