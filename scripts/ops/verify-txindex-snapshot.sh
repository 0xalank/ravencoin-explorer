#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/ops/verify-txindex-snapshot.sh ARCHIVE.tar.zst [--boot]

Requires and verifies the SHA-256 sidecar and versioned manifest, tests the
zstd/tar streams and safe archive layout, and optionally boots the extracted
snapshot without networking. Boot mode compares height, hash, chainwork, Core
version and the historical txindex probe with the manifest.

Optional: TXINDEX_VERIFY_DIR, RAVEN_IMAGE_TAG, TXINDEX_BOOT_TIMEOUT_SECONDS.
USAGE
}

archive="${1:-}"
boot="${2:-}"
if [[ "$archive" == "--help" || "$archive" == "-h" ]]; then usage; exit 0; fi
if [[ -z "$archive" || ( -n "$boot" && "$boot" != "--boot" ) || $# -gt 2 ]]; then usage >&2; exit 2; fi
[[ -f "$archive" ]] || { echo "Archive not found: $archive" >&2; exit 1; }
for command_name in jq realpath sha256sum tar zstd; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done

archive="$(realpath -- "$archive")"
archive_name="$(basename -- "$archive")"
base="${archive_name%.tar.zst}"
checksum="$archive.sha256"
manifest="$(dirname -- "$archive")/$base.manifest.json"
[[ -f "$checksum" ]] || { echo "Checksum sidecar not found: $checksum" >&2; exit 1; }
[[ -f "$manifest" ]] || { echo "Manifest not found: $manifest" >&2; exit 1; }

(cd -- "$(dirname -- "$archive")" && sha256sum --check "$(basename -- "$checksum")")
archive_sha256="$(sha256sum "$archive" | awk '{print $1}')"
manifest_archive="$(jq -r '.archive' "$manifest")"
manifest_sha256="$(jq -r '.sha256' "$manifest")"
manifest_txindex="$(jq -r '.txindex' "$manifest")"
manifest_assetindex="$(jq -r '.assetindex' "$manifest")"
manifest_pruned="$(jq -r '.pruned' "$manifest")"
[[ "$manifest_archive" == "$archive_name" && "$manifest_sha256" == "$archive_sha256" ]] || { echo "Manifest does not match archive/checksum." >&2; exit 1; }
[[ "$manifest_txindex" == true && "$manifest_assetindex" == true && "$manifest_pruned" == false ]] || { echo "Manifest index/pruning flags are invalid." >&2; exit 1; }

zstd -q -t "$archive"
catalog="$(mktemp)"
paths="$(mktemp)"
verify_root=''
container_name=''
cleanup() {
  rm -f -- "$catalog" "$paths"
  if [[ -n "$container_name" ]]; then docker stop -t 30 "$container_name" >/dev/null 2>&1 || true; docker rm -f "$container_name" >/dev/null 2>&1 || true; fi
  if [[ -n "$verify_root" && -d "$verify_root" ]]; then
    case "$verify_root" in "${TXINDEX_VERIFY_DIR:-/tmp}"/.txindex-verify.*) rm -rf -- "$verify_root" ;; *) echo "Refusing unsafe verification cleanup: $verify_root" >&2 ;; esac
  fi
}
trap cleanup EXIT INT TERM

tar --use-compress-program=unzstd -tvf "$archive" >"$catalog"
tar --use-compress-program=unzstd -tf "$archive" >"$paths"
if awk '$1 ~ /^l/ {found=1} END {exit !found}' "$catalog"; then echo "Archive contains a symbolic link." >&2; exit 1; fi
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$paths"; then echo "Archive contains an unsafe path." >&2; exit 1; fi
if grep -Eiq '(^|/)(wallet\.dat|wallets/|\.cookie|raven\.conf|onion(_v3)?_private_key)(/|$)' "$paths"; then
  echo "Archive contains credential or wallet material." >&2
  exit 1
fi
for required_path in blocks/index/ chainstate/ assets/ messages/ myrestricted/ rewards/ blocks/blk00000.dat; do
  grep -q "^ravencoin-mainnet/$required_path" "$paths" || { echo "Missing required archive path: $required_path" >&2; exit 1; }
done

if [[ "$boot" == "--boot" ]]; then
  command -v docker >/dev/null || { echo "docker is required for --boot." >&2; exit 1; }
  verify_parent="${TXINDEX_VERIFY_DIR:-/tmp}"
  boot_timeout="${TXINDEX_BOOT_TIMEOUT_SECONDS:-600}"
  minimum_free_bytes="${TXINDEX_MIN_FREE_BYTES:-214748364800}"
  [[ "$boot_timeout" =~ ^[1-9][0-9]*$ ]] || { echo "TXINDEX_BOOT_TIMEOUT_SECONDS must be positive." >&2; exit 2; }
  [[ "$minimum_free_bytes" =~ ^[0-9]+$ ]] || { echo "TXINDEX_MIN_FREE_BYTES must be an integer." >&2; exit 2; }
  mkdir -p -- "$verify_parent"
  datadir_bytes="$(jq -r '.datadirBytes' "$manifest")"
  [[ "$datadir_bytes" =~ ^[0-9]+$ ]] || { echo "Manifest datadirBytes is invalid." >&2; exit 1; }
  available_bytes="$(df --output=avail --block-size=1 "$verify_parent" | tail -n 1 | tr -d '[:space:]')"
  if (( available_bytes < datadir_bytes + minimum_free_bytes )); then
    echo "Insufficient free space for boot verification while preserving reserve." >&2
    exit 1
  fi
  verify_root="$(mktemp -d "$verify_parent/.txindex-verify.XXXXXX")"
  tar --use-compress-program=unzstd -xf "$archive" -C "$verify_root"
  extracted="$(realpath -- "$verify_root/ravencoin-mainnet")"
  case "$extracted" in "$verify_root"/*) ;; *) echo "Extracted datadir escaped verification root." >&2; exit 1 ;; esac
  [[ -d "$extracted" && ! -L "$extracted" ]] || { echo "Extracted datadir is invalid." >&2; exit 1; }

  config="$verify_root/raven.conf"
  printf '%s\n' \
    'server=1' 'prune=0' 'txindex=1' 'assetindex=1' 'listen=0' 'discover=0' \
    'rpcbind=127.0.0.1' 'rpcallowip=127.0.0.1/32' \
    'rpcuser=snapshotverify' 'rpcpassword=snapshotverify-isolated' >"$config"
  container_name="rvn-txindex-verify-$$"
  docker run -d --name "$container_name" --network none --memory 24g \
    -v "$extracted:/data" -v "$config:/etc/ravencoin/raven.conf:ro" \
    "dominant-ravencoin-node:${RAVEN_IMAGE_TAG:-1ecb659}" \
    -datadir=/data -conf=/etc/ravencoin/raven.conf -onlynet=ipv4 >/dev/null

  ready=false
  for _ in $(seq 1 "$boot_timeout"); do
    if docker exec "$container_name" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  [[ "$ready" == true ]] || { echo "Extracted snapshot did not boot within $boot_timeout seconds." >&2; exit 1; }

  chain_info="$(docker exec "$container_name" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getblockchaininfo)"
  network_info="$(docker exec "$container_name" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getnetworkinfo)"
  actual_height="$(printf '%s' "$chain_info" | jq -r '.blocks')"
  actual_hash="$(printf '%s' "$chain_info" | jq -r '.bestblockhash')"
  actual_chainwork="$(printf '%s' "$chain_info" | jq -r '.chainwork')"
  actual_version="$(printf '%s' "$network_info" | jq -r '.subversion')"
  [[ "$actual_height" == "$(jq -r '.height' "$manifest")" ]] || { echo "Booted height differs from manifest." >&2; exit 1; }
  [[ "$actual_hash" == "$(jq -r '.bestBlockHash' "$manifest")" ]] || { echo "Booted best hash differs from manifest." >&2; exit 1; }
  [[ "$actual_chainwork" == "$(jq -r '.chainwork' "$manifest")" ]] || { echo "Booted chainwork differs from manifest." >&2; exit 1; }
  [[ "$actual_version" == "$(jq -r '.coreVersion' "$manifest")" ]] || { echo "Booted Core version differs from manifest." >&2; exit 1; }
  probe_txid="$(jq -r '.probe.txid' "$manifest")"
  expected_block="$(jq -r '.probe.blockHash' "$manifest")"
  transaction="$(docker exec "$container_name" raven-cli -datadir=/data -conf=/etc/ravencoin/raven.conf getrawtransaction "$probe_txid" true)"
  actual_block="$(printf '%s' "$transaction" | jq -r '.blockhash // empty')"
  [[ "$actual_block" == "$expected_block" ]] || { echo "Booted snapshot failed txindex probe." >&2; exit 1; }
  echo "Boot verification passed at height $actual_height."
fi

echo "Txindex snapshot verified: $archive"
