#!/usr/bin/env bash
set -Eeuo pipefail

compose_file="${COMPOSE_FILE:-compose.txindex.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env.txindex}"
compose_project="${COMPOSE_PROJECT_NAME:-ravencoin-txindex}"
poll_seconds="${TXINDEX_PUBLISH_POLL_SECONDS:-30}"
verify_boot="${TXINDEX_VERIFY_BOOT_AFTER_PUBLISH:-true}"
maximum_lag="${TXINDEX_MAX_SNAPSHOT_LAG:-20}"

[[ "$poll_seconds" =~ ^[1-9][0-9]*$ ]] || { echo "TXINDEX_PUBLISH_POLL_SECONDS must be positive." >&2; exit 2; }
[[ "$verify_boot" == true || "$verify_boot" == false ]] || { echo "TXINDEX_VERIFY_BOOT_AFTER_PUBLISH must be true or false." >&2; exit 2; }
if [[ -f "$compose_env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$compose_env_file"
  set +a
fi
maximum_lag="${TXINDEX_MAX_SNAPSHOT_LAG:-$maximum_lag}"
[[ "$maximum_lag" =~ ^[0-9]+$ ]] || { echo "TXINDEX_MAX_SNAPSHOT_LAG must be a non-negative integer." >&2; exit 2; }
compose=(docker compose --project-name "$compose_project" --env-file "$compose_env_file" -f "$compose_file")

builder_id="$("${compose[@]}" ps -q ravend-txindex)"
[[ -n "$builder_id" ]] || { echo "Txindex builder container is missing or stopped." >&2; exit 1; }
builder_started="$(docker inspect --format '{{.State.StartedAt}}' "$builder_id")"
builder_restart_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$builder_id")"
builder_restart_count="$(docker inspect --format '{{.RestartCount}}' "$builder_id")"
[[ "$builder_restart_policy" == no && "$builder_restart_count" == 0 ]] || {
  echo "Builder lacks uninterrupted-run safeguards (restart=$builder_restart_policy count=$builder_restart_count)." >&2
  exit 1
}
"${compose[@]}" exec -T ravend-txindex test -f /data/.txindex-rebuild-active || {
  echo "Uninterrupted rebuild marker is missing." >&2
  exit 1
}

echo "Waiting for the uninterrupted Ravencoin txindex rebuild to finish."
while true; do
  container_id="$("${compose[@]}" ps -aq ravend-txindex)"
  [[ "$container_id" == "$builder_id" ]] || { echo "Txindex builder was replaced; refusing publication." >&2; exit 1; }
  running="$(docker inspect --format '{{.State.Running}}' "$container_id")"
  started="$(docker inspect --format '{{.State.StartedAt}}' "$container_id")"
  restart_count="$(docker inspect --format '{{.RestartCount}}' "$container_id")"
  [[ "$running" == true ]] || {
    docker inspect --format 'Txindex builder exited unexpectedly: exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}' "$container_id" >&2
    exit 1
  }
  [[ "$started" == "$builder_started" && "$restart_count" == 0 ]] || {
    echo "Txindex builder restarted; refusing publication." >&2
    exit 1
  }
  logs="$("${compose[@]}" logs --no-color --since="$((poll_seconds + 15))s" ravend-txindex)"
  if grep -Eq 'ERROR: ConnectBlock|ConnectTip\(\).*failed|Corruption:|Fatal LevelDB error' <<<"$logs"; then
    echo "Consensus or database error detected; refusing automatic publication." >&2
    grep -E 'ERROR: ConnectBlock|ConnectTip\(\).*failed|Corruption:|Fatal LevelDB error' <<<"$logs" >&2
    exit 1
  fi
  if chain_info="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo 2>/dev/null)"; then
    height="$(jq -r '.blocks' <<<"$chain_info")"
    headers="$(jq -r '.headers' <<<"$chain_info")"
    reference_height="$(docker exec "${TXINDEX_REFERENCE_CONTAINER:-ravencoin-explorer-ravend-1}" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockcount)"
    lag="$((reference_height - height))"
    if [[ "$height" == "$headers" && "$lag" -ge 0 && "$lag" -le "$maximum_lag" ]]; then break; fi
  fi
  sleep "$poll_seconds"
done

echo "Core fully activated at the canonical tip; running canonical and index probes."
bash scripts/ops/txindex-finalize.sh
bash scripts/ops/txindex-snapshot.sh

latest_manifest="$(jq -r '.manifest' "$TXINDEX_SNAPSHOT_DIR/latest.json")"
latest_archive="$(jq -r '.archive' "$TXINDEX_SNAPSHOT_DIR/latest.json")"
snapshot_root="$(realpath -- "$TXINDEX_SNAPSHOT_DIR")"
manifest="$(realpath -m -- "$snapshot_root/$latest_manifest")"
archive="$(realpath -m -- "$snapshot_root/$latest_archive")"
case "$manifest" in "$snapshot_root"/releases/*) ;; *) echo "latest.json contains an unsafe manifest path." >&2; exit 1 ;; esac
case "$archive" in "$snapshot_root"/releases/*) ;; *) echo "latest.json contains an unsafe archive path." >&2; exit 1 ;; esac
[[ -f "$manifest" && -f "$archive" ]] || { echo "Published snapshot files are missing." >&2; exit 1; }
if [[ "$verify_boot" == true ]]; then
  TXINDEX_VERIFY_DIR="$TXINDEX_STAGING_DIR" bash scripts/ops/verify-txindex-snapshot.sh "$archive" --boot
else
  bash scripts/ops/verify-txindex-snapshot.sh "$archive"
fi

"${compose[@]}" up -d snapshot-server
server_ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:"${TXINDEX_SNAPSHOT_PORT:-3103}"/latest.json >/dev/null; then server_ready=true; break; fi
  sleep 1
done
[[ "$server_ready" == true ]] || { echo "Snapshot download service did not become healthy." >&2; exit 1; }
echo "Verified txindex snapshot published and download service is healthy."
echo "Archive: $archive"
