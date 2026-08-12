#!/usr/bin/env bash
set -Eeuo pipefail

compose_file="${COMPOSE_FILE:-compose.txindex.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env.txindex}"
compose_project="${COMPOSE_PROJECT_NAME:-ravencoin-txindex}"
reference_container="${TXINDEX_REFERENCE_CONTAINER:-ravencoin-explorer-ravend-1}"
maximum_lag="${TXINDEX_MAX_SNAPSHOT_LAG:-20}"
boot_timeout="${TXINDEX_BOOT_TIMEOUT_SECONDS:-600}"
probe_txid="${TXINDEX_PROBE_TXID:-3480049256d63cd936a387874fc437912575f782259badac7a09054b94b3a6d8}"
expected_block="${TXINDEX_PROBE_BLOCK:-00000058bcc33dea08b53691edb9e49a9eb8bac36a0db17eb5a7588860b1f590}"

command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
[[ "$boot_timeout" =~ ^[1-9][0-9]*$ ]] || { echo "TXINDEX_BOOT_TIMEOUT_SECONDS must be positive." >&2; exit 2; }
compose=(docker compose --project-name "$compose_project")
if [[ -f "$compose_env_file" ]]; then compose+=(--env-file "$compose_env_file"); fi
compose+=(-f "$compose_file")

finalize_logs="$("${compose[@]}" logs --no-color ravend-txindex)"
if ! grep -q 'Reindexing finished' <<<"$finalize_logs" && ! "${compose[@]}" exec -T ravend-txindex test -f /data/.txindex-reindex-complete; then
  echo "Refusing to finalize before Core reports 'Reindexing finished'." >&2
  exit 1
fi

chain_info="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo)"
height="$(printf '%s' "$chain_info" | jq -r '.blocks')"
best_hash="$(printf '%s' "$chain_info" | jq -r '.bestblockhash')"
reference_height="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockcount)"
canonical_hash="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockhash "$height")"
lag="$((reference_height - height))"
[[ "$best_hash" == "$canonical_hash" && "$lag" -ge 0 && "$lag" -le "$maximum_lag" ]] || {
  echo "Rebuilt node is not on the current canonical chain (height=$height reference=$reference_height lag=$lag)." >&2
  exit 1
}

transaction="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getrawtransaction "$probe_txid" true)"
actual_block="$(printf '%s' "$transaction" | jq -r '.blockhash // empty')"
[[ "$actual_block" == "$expected_block" ]] || { echo "Historical txindex probe failed." >&2; exit 1; }

"${compose[@]}" exec -T ravend-txindex touch /data/.txindex-reindex-complete
env TXINDEX_REINDEX=false "${compose[@]}" up -d --force-recreate ravend-txindex

ready=false
for _ in $(seq 1 "$boot_timeout"); do
  if "${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo "Normal-mode txindex node did not restart within $boot_timeout seconds." >&2; exit 1; }

transaction="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getrawtransaction "$probe_txid" true)"
actual_block="$(printf '%s' "$transaction" | jq -r '.blockhash // empty')"
[[ "$actual_block" == "$expected_block" ]] || { echo "txindex did not persist across the normal-mode restart." >&2; exit 1; }

"${compose[@]}" exec -T ravend-txindex touch /data/.txindex-ready

echo "txindex rebuild finalized and verified after a normal restart at height $height."
