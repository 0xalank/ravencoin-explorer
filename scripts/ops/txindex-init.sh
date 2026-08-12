#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${TXINDEX_ENV_FILE:-.env.txindex}"
example_env="${TXINDEX_ENV_EXAMPLE:-.env.txindex.example}"
config_example="${TXINDEX_CONFIG_EXAMPLE:-ops/txindex/raven.conf.example}"

if [[ ! -f "$env_file" ]]; then
  [[ -f "$example_env" ]] || { echo "Environment example not found: $example_env" >&2; exit 1; }
  cp -- "$example_env" "$env_file"
  chmod 600 -- "$env_file"
  echo "Created $env_file"
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

required=(TXINDEX_ALLOWED_ROOT TXINDEX_DATA_DIR TXINDEX_STAGING_DIR TXINDEX_SNAPSHOT_DIR TXINDEX_CONFIG_FILE)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "$name is required in $env_file." >&2; exit 1; }
done

allowed_root="$(realpath -m -- "$TXINDEX_ALLOWED_ROOT")"
case "$allowed_root" in
  /|/home|/mnt|/mnt/combined) echo "TXINDEX_ALLOWED_ROOT is too broad: $allowed_root" >&2; exit 1 ;;
esac

for path in "$TXINDEX_DATA_DIR" "$TXINDEX_STAGING_DIR" "$TXINDEX_SNAPSHOT_DIR"; do
  canonical="$(realpath -m -- "$path")"
  case "$canonical" in
    "$allowed_root"/*) ;;
    *) echo "Path escapes TXINDEX_ALLOWED_ROOT: $canonical" >&2; exit 1 ;;
  esac
done

canonical_data="$(realpath -m -- "$TXINDEX_DATA_DIR")"
canonical_staging="$(realpath -m -- "$TXINDEX_STAGING_DIR")"
canonical_snapshots="$(realpath -m -- "$TXINDEX_SNAPSHOT_DIR")"
paths=("$canonical_data" "$canonical_staging" "$canonical_snapshots")
if [[ "$canonical_data" == "$canonical_staging" || "$canonical_data" == "$canonical_snapshots" || "$canonical_staging" == "$canonical_snapshots" ]]; then
  echo "Txindex data, staging, and snapshot paths must be distinct." >&2
  exit 1
fi
for left in "${paths[@]}"; do
  for right in "${paths[@]}"; do
    [[ "$left" == "$right" ]] && continue
    case "$right" in "$left"/*) echo "Txindex paths must not overlap: $left and $right" >&2; exit 1 ;; esac
  done
done

mkdir -p -- "$allowed_root" "$canonical_data" "$canonical_staging" "$canonical_snapshots/releases"
chmod 700 -- "$canonical_data" "$canonical_staging"
chmod 755 -- "$canonical_snapshots" "$canonical_snapshots/releases"

if [[ ! -f "$TXINDEX_CONFIG_FILE" ]]; then
  [[ -f "$config_example" ]] || { echo "Config example not found: $config_example" >&2; exit 1; }
  command -v openssl >/dev/null || { echo "openssl is required to generate RPC credentials." >&2; exit 1; }
  mkdir -p -- "$(dirname -- "$TXINDEX_CONFIG_FILE")"
  cp -- "$config_example" "$TXINDEX_CONFIG_FILE"
  rpc_user="rvntxindex$(openssl rand -hex 12)"
  rpc_password="$(openssl rand -hex 32)"
  sed -i \
    -e "s/^rpcuser=.*/rpcuser=$rpc_user/" \
    -e "s/^rpcpassword=.*/rpcpassword=$rpc_password/" \
    "$TXINDEX_CONFIG_FILE"
  chmod 600 -- "$TXINDEX_CONFIG_FILE"
  echo "Created private RPC configuration: $TXINDEX_CONFIG_FILE"
fi
if grep -q 'replace-with-' "$TXINDEX_CONFIG_FILE"; then
  echo "RPC placeholders remain in $TXINDEX_CONFIG_FILE; refusing insecure startup." >&2
  exit 1
fi

echo "Txindex directories are initialized beneath $allowed_root."
