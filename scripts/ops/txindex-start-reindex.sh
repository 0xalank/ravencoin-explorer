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
[[ ! -e "$data_dir/.txindex-reindex-started" ]] || { echo "One-time reindex was already requested. Start normally to resume it." >&2; exit 1; }

echo "Starting the one-time reindex request."
TXINDEX_REINDEX=true "${compose[@]}" up -d --force-recreate ravend-txindex

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

touch -- "$data_dir/.txindex-reindex-started"
echo "Core persisted its internal reindex state; recreating without explicit -reindex so all future restarts resume safely."
TXINDEX_REINDEX=false "${compose[@]}" up -d --force-recreate ravend-txindex

echo "One-time reindex is running in restart-safe mode. Use pnpm ops:txindex:status to check progress."
