#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/ops/verify-postgres-snapshot.sh SNAPSHOT.dump

Requires and checks the SHA-256 sidecar, then asks a version-compatible
pg_restore to read the archive catalog. This does not modify any database.

Set SNAPSHOT_ALLOW_MISSING_CHECKSUM=true only for a trusted legacy archive.
SNAPSHOT_VERIFY_MODE may be auto, compose, or local (default: auto).
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if (( $# != 1 )); then
  usage >&2
  exit 2
fi

archive="$1"
[[ -f "$archive" ]] || { echo "Snapshot not found: $archive" >&2; exit 1; }
[[ -s "$archive" ]] || { echo "Snapshot is empty: $archive" >&2; exit 1; }
allow_missing_checksum="${SNAPSHOT_ALLOW_MISSING_CHECKSUM:-false}"
if [[ ! "$allow_missing_checksum" =~ ^(true|false)$ ]]; then
  echo "SNAPSHOT_ALLOW_MISSING_CHECKSUM must be true or false." >&2
  exit 2
fi
verify_mode="${SNAPSHOT_VERIFY_MODE:-auto}"
if [[ ! "$verify_mode" =~ ^(auto|compose|local)$ ]]; then
  echo "SNAPSHOT_VERIFY_MODE must be auto, compose, or local." >&2
  exit 2
fi

archive_directory="$(cd -- "$(dirname -- "$archive")" && pwd)"
archive_name="$(basename -- "$archive")"
if [[ -f "$archive.sha256" ]]; then
  (cd -- "$archive_directory" && sha256sum --check "$archive_name.sha256")
else
  if [[ "$allow_missing_checksum" != 'true' ]]; then
    echo "Refusing unverifiable archive: checksum sidecar not found at $archive.sha256" >&2
    exit 1
  fi
  echo "WARN Proceeding without a checksum because SNAPSHOT_ALLOW_MISSING_CHECKSUM=true." >&2
fi

compose_file="${COMPOSE_FILE:-compose.remote.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env}"
compose=(docker compose)
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then compose+=(--project-name "$COMPOSE_PROJECT_NAME"); fi
if [[ -f "$compose_env_file" ]]; then compose+=(--env-file "$compose_env_file"); fi
compose+=(-f "$compose_file")

compose_postgres=''
if command -v docker >/dev/null && [[ -f "$compose_file" ]]; then
  compose_postgres="$("${compose[@]}" ps -q postgres 2>/dev/null || true)"
fi

# Prefer the running Compose PostgreSQL client: its major version matches the
# server that produced production archives. Older host clients cannot read a
# newer custom-format header.
case "$verify_mode" in
  compose)
    [[ -n "$compose_postgres" ]] || { echo "The Compose postgres service is not running." >&2; exit 1; }
    "${compose[@]}" exec -T postgres pg_restore --list <"$archive" >/dev/null
    ;;
  local)
    command -v pg_restore >/dev/null || { echo "A local pg_restore is required." >&2; exit 1; }
    pg_restore --list "$archive" >/dev/null
    ;;
  auto)
    if [[ -n "$compose_postgres" ]]; then
      "${compose[@]}" exec -T postgres pg_restore --list <"$archive" >/dev/null
    elif command -v pg_restore >/dev/null; then
      pg_restore --list "$archive" >/dev/null
    else
      echo "pg_restore is unavailable locally and the Compose postgres service cannot be used." >&2
      exit 1
    fi
    ;;
esac

echo "Snapshot archive is readable: $archive"
