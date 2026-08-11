#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/ops/postgres-snapshot.sh [OUTPUT_DIRECTORY]

Creates a transactionally consistent PostgreSQL custom-format archive, verifies
that pg_restore can read it, and writes a SHA-256 sidecar. Existing files are
never overwritten and snapshots are never deleted automatically.

Modes:
  BACKUP_DATABASE_URL=postgresql://...  Use locally installed pg_dump/pg_restore.
  Otherwise                              Use the postgres service via Docker Compose.

Optional: SNAPSHOT_DIR, SNAPSHOT_COMPRESSION (0-9), COMPOSE_FILE,
COMPOSE_ENV_FILE, COMPOSE_PROJECT_NAME. During catch-up the command refuses to
run unless SNAPSHOT_ALLOW_SYNCING=true is explicitly set.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if (( $# > 1 )); then
  usage >&2
  exit 2
fi

umask 077
output_directory="${1:-${SNAPSHOT_DIR:-./backups/postgres}}"
compression="${SNAPSHOT_COMPRESSION:-6}"
if [[ ! "$compression" =~ ^[0-9]$ ]]; then
  echo "SNAPSHOT_COMPRESSION must be an integer from 0 through 9." >&2
  exit 2
fi
allow_syncing="${SNAPSHOT_ALLOW_SYNCING:-false}"
if [[ ! "$allow_syncing" =~ ^(true|false)$ ]]; then
  echo "SNAPSHOT_ALLOW_SYNCING must be true or false." >&2
  exit 2
fi
mkdir -p -- "$output_directory"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
archive="$output_directory/ravencoin-explorer-$timestamp.dump"
if [[ -e "$archive" || -e "$archive.sha256" ]]; then
  echo "Refusing to overwrite existing snapshot: $archive" >&2
  exit 1
fi
temporary="$(mktemp "$output_directory/.ravencoin-explorer-$timestamp.XXXXXX.partial")"
cleanup() {
  if [[ -n "${temporary:-}" && -e "$temporary" ]]; then rm -f -- "$temporary"; fi
}
trap cleanup EXIT INT TERM

compose_file="${COMPOSE_FILE:-compose.remote.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env}"
compose=(docker compose)
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then compose+=(--project-name "$COMPOSE_PROJECT_NAME"); fi
if [[ -f "$compose_env_file" ]]; then compose+=(--env-file "$compose_env_file"); fi
compose+=(-f "$compose_file")

if [[ -n "${BACKUP_DATABASE_URL:-}" ]]; then
  command -v node >/dev/null || { echo "node is required to handle BACKUP_DATABASE_URL without exposing its password." >&2; exit 1; }
  command -v pg_dump >/dev/null || { echo "pg_dump is required for BACKUP_DATABASE_URL mode." >&2; exit 1; }
  command -v pg_restore >/dev/null || { echo "pg_restore is required to verify the archive." >&2; exit 1; }
  command -v psql >/dev/null || { echo "psql is required to check indexer state." >&2; exit 1; }
  ambient_pgpassword="${PGPASSWORD:-}"
  mapfile -d '' -t database_url_parts < <(node "$(dirname -- "$0")/redact-database-url.mjs" <<<"$BACKUP_DATABASE_URL")
  if (( ${#database_url_parts[@]} != 2 )) || [[ -z "${database_url_parts[0]}" ]]; then
    echo "Unable to parse BACKUP_DATABASE_URL safely." >&2
    exit 1
  fi
  backup_database_safe_url="${database_url_parts[0]}"
  unset BACKUP_DATABASE_URL PGPASSWORD
  backup_database_password="${database_url_parts[1]:-$ambient_pgpassword}"
  if [[ -n "$backup_database_password" ]]; then export PGPASSWORD="$backup_database_password"; fi
  sync_status="$(psql --dbname="$backup_database_safe_url" --no-psqlrc --tuples-only --no-align \
    --command "SELECT status FROM sync_state WHERE id = 'ravencoin-mainnet';")"
  sync_status="${sync_status//[[:space:]]/}"
  if [[ "$sync_status" != 'ready' && "$allow_syncing" != 'true' ]]; then
    echo "Refusing snapshot while indexer status is '${sync_status:-unknown}'. Set SNAPSHOT_ALLOW_SYNCING=true to override." >&2
    exit 1
  fi
  pg_dump --dbname="$backup_database_safe_url" \
    --format=custom --compress="$compression" --no-owner --no-privileges \
    --file="$temporary"
  pg_restore --list "$temporary" >/dev/null
else
  command -v docker >/dev/null || { echo "docker is required for Compose snapshot mode." >&2; exit 1; }
  [[ -f "$compose_file" ]] || { echo "Compose file not found: $compose_file" >&2; exit 1; }
  sync_status="$("${compose[@]}" exec -T postgres sh -eu -c \
    'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-psqlrc --tuples-only --no-align --command "SELECT status FROM sync_state WHERE id = '\''ravencoin-mainnet'\'';"')"
  sync_status="${sync_status//[[:space:]]/}"
  if [[ "$sync_status" != 'ready' && "$allow_syncing" != 'true' ]]; then
    echo "Refusing snapshot while indexer status is '${sync_status:-unknown}'. Set SNAPSHOT_ALLOW_SYNCING=true to override." >&2
    exit 1
  fi
  "${compose[@]}" exec -T -e SNAPSHOT_COMPRESSION="$compression" postgres sh -eu -c \
    'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress="$SNAPSHOT_COMPRESSION" --no-owner --no-privileges' \
    >"$temporary"
  "${compose[@]}" exec -T postgres pg_restore --list <"$temporary" >/dev/null
fi

[[ -s "$temporary" ]] || { echo "Snapshot archive is empty." >&2; exit 1; }
mv -- "$temporary" "$archive"
temporary=''
(
  cd -- "$output_directory"
  sha256sum "$(basename -- "$archive")" >"$(basename -- "$archive").sha256"
)
chmod 600 -- "$archive" "$archive.sha256"

echo "PostgreSQL snapshot created and verified: $archive"
echo "Archive size: $(du -h -- "$archive" | awk '{print $1}')"
echo "Checksum: $archive.sha256"
