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
asset_probe_name="${TXINDEX_ASSET_PROBE_NAME:-VOTE}"
asset_probe_txid="${TXINDEX_ASSET_PROBE_ISSUANCE_TXID:-5970eb4352dd92da8404f55660f978842482b9daeb01a5c41f8f700b2cf2cb5b}"
asset_probe_block="${TXINDEX_ASSET_PROBE_BLOCK:-00000000000048f3a8a70663e44a71f032e847ed2082fb3792c45089888c699f}"
asset_probe_amount="${TXINDEX_ASSET_PROBE_AMOUNT:-10000000}"
asset_probe_units="${TXINDEX_ASSET_PROBE_UNITS:-8}"
asset_probe_reissuable="${TXINDEX_ASSET_PROBE_REISSUABLE:-1}"
asset_probe_has_ipfs="${TXINDEX_ASSET_PROBE_HAS_IPFS:-0}"

command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
[[ "$boot_timeout" =~ ^[1-9][0-9]*$ ]] || { echo "TXINDEX_BOOT_TIMEOUT_SECONDS must be positive." >&2; exit 2; }
[[ "$probe_txid" =~ ^[0-9a-fA-F]{64}$ && "$expected_block" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Historical txindex probe IDs must be 64 hexadecimal characters." >&2; exit 2; }
[[ -n "$asset_probe_name" ]] || { echo "TXINDEX_ASSET_PROBE_NAME must not be empty." >&2; exit 2; }
[[ "$asset_probe_txid" =~ ^[0-9a-fA-F]{64}$ && "$asset_probe_block" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Asset probe transaction and block IDs must be 64 hexadecimal characters." >&2; exit 2; }
[[ "$asset_probe_amount" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "TXINDEX_ASSET_PROBE_AMOUNT must be a non-negative JSON number." >&2; exit 2; }
[[ "$asset_probe_units" =~ ^[0-9]+$ ]] || { echo "TXINDEX_ASSET_PROBE_UNITS must be a non-negative integer." >&2; exit 2; }
[[ "$asset_probe_reissuable" =~ ^[01]$ && "$asset_probe_has_ipfs" =~ ^[01]$ ]] || { echo "Asset reissuable and has_ipfs probe values must be 0 or 1." >&2; exit 2; }
compose=(docker compose --project-name "$compose_project")
if [[ -f "$compose_env_file" ]]; then compose+=(--env-file "$compose_env_file"); fi
compose+=(-f "$compose_file")

if ! "${compose[@]}" exec -T ravend-txindex sh -c 'test -f /data/.txindex-rebuild-active || test -f /data/.txindex-reindex-complete'; then
  echo "Refusing to finalize a node without uninterrupted rebuild evidence." >&2
  exit 1
fi
chain_info="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo)"
height="$(printf '%s' "$chain_info" | jq -r '.blocks')"
headers="$(printf '%s' "$chain_info" | jq -r '.headers')"
best_hash="$(printf '%s' "$chain_info" | jq -r '.bestblockhash')"
reference_height="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockcount)"
canonical_hash="$(docker exec "$reference_container" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockhash "$height")"
lag="$((reference_height - height))"
[[ "$height" == "$headers" && "$best_hash" == "$canonical_hash" && "$lag" -ge 0 && "$lag" -le "$maximum_lag" ]] || {
  echo "Rebuilt node is not fully activated on the current canonical chain (height=$height headers=$headers reference=$reference_height lag=$lag)." >&2
  exit 1
}

transaction="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getrawtransaction "$probe_txid" true)"
actual_block="$(printf '%s' "$transaction" | jq -r '.blockhash // empty')"
[[ "$actual_block" == "$expected_block" ]] || { echo "Historical txindex probe failed." >&2; exit 1; }

verify_asset_probe() {
  local context="$1" issuance asset_block asset_data
  issuance="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getrawtransaction "$asset_probe_txid" true)"
  asset_block="$(printf '%s' "$issuance" | jq -r '.blockhash // empty')"
  [[ "$asset_block" == "$asset_probe_block" ]] || { echo "$context asset issuance transaction is not in the expected block." >&2; return 1; }
  asset_data="$("${compose[@]}" exec -T ravend-txindex raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getassetdata "$asset_probe_name")"
  printf '%s' "$asset_data" | jq -e \
    --arg name "$asset_probe_name" \
    --argjson amount "$asset_probe_amount" \
    --argjson units "$asset_probe_units" \
    --argjson reissuable "$asset_probe_reissuable" \
    --argjson has_ipfs "$asset_probe_has_ipfs" \
    '.name == $name and
     ((.amount | tonumber) == $amount) and
     ((.units | tonumber) == $units) and
     ((.reissuable | tonumber) == $reissuable) and
     ((.has_ipfs | tonumber) == $has_ipfs)' >/dev/null || {
      echo "$context asset-state probe failed for $asset_probe_name." >&2
      return 1
    }
}

verify_asset_probe "Rebuilt node"

"${compose[@]}" exec -T ravend-txindex touch /data/.txindex-reindex-complete
env TXINDEX_REINDEX=false TXINDEX_RESTART_POLICY=unless-stopped "${compose[@]}" up -d --force-recreate ravend-txindex

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
verify_asset_probe "Restarted node"

"${compose[@]}" exec -T ravend-txindex rm -f /data/.txindex-rebuild-active
"${compose[@]}" exec -T ravend-txindex touch /data/.txindex-ready

echo "txindex rebuild finalized and verified after a normal restart at height $height."
