#!/usr/bin/env bash
set -Eeuo pipefail

compose_file="${COMPOSE_FILE:-compose.txindex.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env.txindex}"
compose_project="${COMPOSE_PROJECT_NAME:-ravencoin-txindex}"
reference_container="${TXINDEX_REFERENCE_CONTAINER:-ravencoin-explorer-ravend-1}"
maximum_lag="${TXINDEX_MAX_SNAPSHOT_LAG:-20}"
probe_txid="${TXINDEX_PROBE_TXID:-3480049256d63cd936a387874fc437912575f782259badac7a09054b94b3a6d8}"
expected_block="${TXINDEX_PROBE_BLOCK:-00000058bcc33dea08b53691edb9e49a9eb8bac36a0db17eb5a7588860b1f590}"

compose=(docker compose --project-name "$compose_project")
if [[ -f "$compose_env_file" ]]; then compose+=(--env-file "$compose_env_file"); fi
compose+=(-f "$compose_file")

command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
"${compose[@]}" ps ravend-txindex
if ! chain_info="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo 2>/dev/null)"; then
  echo "txindex node RPC is not ready. Recent output:"
  "${compose[@]}" logs --no-color --tail=20 ravend-txindex
  exit 1
fi
printf '%s\n' "$chain_info"

builder_height="$(printf '%s' "$chain_info" | jq -r '.blocks')"
builder_hash="$(printf '%s' "$chain_info" | jq -r '.bestblockhash')"
reference_height="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockcount)"
canonical_hash="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockhash "$builder_height")"
lag="$((reference_height - builder_height))"
reindex_finished=false
status_logs="$("${compose[@]}" logs --no-color ravend-txindex)"
if grep -q 'Reindexing finished' <<<"$status_logs"; then reindex_finished=true; fi
if "${compose[@]}" exec -T ravend-txindex test -f /data/.txindex-reindex-complete; then reindex_finished=true; fi
ready_marker=false
if "${compose[@]}" exec -T ravend-txindex test -f /data/.txindex-ready; then ready_marker=true; fi

if transaction="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getrawtransaction "$probe_txid" true 2>/dev/null)"; then
  actual_block="$(printf '%s' "$transaction" | jq -r '.blockhash // empty')"
  if [[ "$actual_block" != "$expected_block" ]]; then
    echo "Historical transaction returned unexpected block hash: ${actual_block:-missing}" >&2
    exit 1
  fi
  probe_ready=true
  echo "txindex probe: present ($probe_txid -> $actual_block)"
else
  probe_ready=false
  echo "txindex probe: not present"
fi

printf 'referenceHeight=%s lag=%s canonical=%s reindexFinished=%s readyMarker=%s\n' \
  "$reference_height" "$lag" "$([[ "$builder_hash" == "$canonical_hash" ]] && echo true || echo false)" "$reindex_finished" "$ready_marker"

if [[ "$probe_ready" != true || "$builder_hash" != "$canonical_hash" || "$lag" -lt 0 || "$lag" -gt "$maximum_lag" ]]; then
  echo "txindex node is not ready." >&2
  exit 1
fi
if [[ "$ready_marker" != true && "$reindex_finished" != true ]]; then
  echo "txindex rebuild has not produced durable completion evidence." >&2
  exit 1
fi
echo "txindex node: ready"
