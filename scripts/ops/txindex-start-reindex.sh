#!/usr/bin/env bash
set -Eeuo pipefail

compose_file="${COMPOSE_FILE:-compose.txindex.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env.txindex}"
compose_project="${COMPOSE_PROJECT_NAME:-ravencoin-txindex}"
start_timeout="${TXINDEX_REINDEX_START_TIMEOUT_SECONDS:-300}"

[[ "$start_timeout" =~ ^[1-9][0-9]*$ ]] || { echo "TXINDEX_REINDEX_START_TIMEOUT_SECONDS must be positive." >&2; exit 2; }
compose=(docker compose --project-name "$compose_project" --env-file "$compose_env_file" -f "$compose_file")

data_dir="$(docker compose --project-name "$compose_project" --env-file "$compose_env_file" -f "$compose_file" config --format json | jq -r '.services["ravend-txindex"].volumes[] | select(.target=="/data") | .source')"
[[ -f "$data_dir/blocks/blk00000.dat" ]] || { echo "Seeded blk00000.dat not found at $data_dir." >&2; exit 1; }
[[ ! -e "$data_dir/.txindex-ready" ]] || { echo "txindex node is already finalized; refusing to reindex it." >&2; exit 1; }
[[ ! -e "$data_dir/.txindex-rebuild-active" ]] || { echo "An interrupted rebuild marker exists. Seed a fresh datadir before retrying." >&2; exit 1; }
for derived_path in blocks/index chainstate assets messages myrestricted rewards; do
  [[ ! -e "$data_dir/$derived_path" ]] || {
    echo "Refusing to reindex a partially initialized datadir ($derived_path exists). Seed a fresh datadir." >&2
    exit 1
  }
done

echo "Starting the one-time reindex request."
TXINDEX_REINDEX=true TXINDEX_RESTART_POLICY=no "${compose[@]}" up -d --force-recreate ravend-txindex

started=false
for _ in $(seq 1 "$start_timeout"); do
  recent_logs="$("${compose[@]}" logs --no-color --since=10m ravend-txindex)"
  if grep -Eq 'Reindexing block file blk00000\.dat|Reindexing finished' <<<"$recent_logs"; then
    started=true
    break
  fi
  if ! "${compose[@]}" ps --status running -q ravend-txindex | grep -q .; then
    echo "Ravencoin exited before persisting its reindex state." >&2
    "${compose[@]}" logs --no-color --tail=100 ravend-txindex >&2
    exit 1
  fi
  sleep 1
done
[[ "$started" == true ]] || { echo "Core did not confirm reindex start within $start_timeout seconds; leaving the request container for inspection." >&2; exit 1; }

touch -- "$data_dir/.txindex-rebuild-active"
echo "One-time reindex is running with automatic restarts disabled."
echo "This Core version must finish asset replay in this process. If it exits early, seed a fresh datadir and rebuild again."
echo "Use pnpm ops:txindex:status to check progress."
