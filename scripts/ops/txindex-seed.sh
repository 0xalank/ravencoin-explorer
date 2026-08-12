#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/ops/txindex-seed.sh [SOURCE_DATADIR] [TARGET_DATADIR]

Seeds a new txindex datadir with immutable, closed blk*.dat files from a live,
unpruned Ravencoin node. The active final block file is deliberately omitted;
the new node downloads that tail after its one-time reindex.

Optional: RAVEN_SOURCE_DATA_DIR, TXINDEX_DATA_DIR.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if (( $# > 2 )); then
  usage >&2
  exit 2
fi

command -v rsync >/dev/null || { echo "rsync is required." >&2; exit 1; }

source_datadir="${1:-${RAVEN_SOURCE_DATA_DIR:-/home/quai/ravencoin-explorer/ravencoin-data}}"
target_datadir="${2:-${TXINDEX_DATA_DIR:-/mnt/combined/soap-quai-explorer/ravencoin-txindex/data}}"
source_blocks="$source_datadir/blocks"
target_blocks="$target_datadir/blocks"
minimum_free_bytes="${TXINDEX_MIN_FREE_BYTES:-214748364800}"
[[ "$minimum_free_bytes" =~ ^[0-9]+$ ]] || { echo "TXINDEX_MIN_FREE_BYTES must be an integer." >&2; exit 2; }

[[ -d "$source_blocks" ]] || { echo "Source block directory not found: $source_blocks" >&2; exit 1; }
[[ -f "$source_blocks/blk00000.dat" ]] || { echo "Source is missing blk00000.dat and appears pruned or incomplete." >&2; exit 1; }
[[ "$source_datadir" != "$target_datadir" ]] || { echo "Source and target datadirs must differ." >&2; exit 1; }
if [[ -e "$target_datadir/chainstate" || -e "$target_blocks/index" ]]; then
  echo "Refusing to seed a datadir that has already been initialized: $target_datadir" >&2
  exit 1
fi

block_list="$(mktemp)"
cleanup() { rm -f -- "$block_list"; }
trap cleanup EXIT INT TERM

find "$source_blocks" -maxdepth 1 -type f -name 'blk*.dat' -printf '%f\n' | LC_ALL=C sort >"$block_list"
block_count="$(wc -l <"$block_list")"
if (( block_count < 2 )); then
  echo "Expected at least two blk*.dat files, found $block_count." >&2
  exit 1
fi

active_block="$(tail -n 1 "$block_list")"
mapfile -t block_files <"$block_list"
for index in "${!block_files[@]}"; do
  expected="$(printf 'blk%05d.dat' "$index")"
  [[ "${block_files[$index]}" == "$expected" ]] || {
    echo "Source block sequence is not contiguous: expected $expected, found ${block_files[$index]}." >&2
    exit 1
  }
done
sed -i '$d' "$block_list"
mkdir -p -- "$target_blocks"

copy_bytes="$(du --bytes --total --files0-from=<(sed "s#^#$source_blocks/#" "$block_list" | tr '\n' '\0') 2>/dev/null | tail -n 1 | awk '{print $1}')"
available_bytes="$(df --output=avail --block-size=1 "$target_blocks" | tail -n 1 | tr -d '[:space:]')"
required_bytes="$((copy_bytes + minimum_free_bytes))"
if (( available_bytes < required_bytes )); then
  echo "Insufficient free space: need $required_bytes bytes including reserve; have $available_bytes." >&2
  exit 1
fi

echo "Copying $((block_count - 1)) closed block files; omitting active file $active_block."
rsync --archive --partial --human-readable --info=progress2 \
  --files-from="$block_list" "$source_blocks/" "$target_blocks/"

echo "Seed complete: $target_datadir"
echo "Start the one-time rebuild with TXINDEX_REINDEX=true; do not add -reindex to the permanent configuration."
