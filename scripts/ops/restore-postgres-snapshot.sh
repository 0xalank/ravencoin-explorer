#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/ops/restore-postgres-snapshot.sh SNAPSHOT.dump --confirm-empty-target

Restores into an existing, empty target database. The command aborts unless the
target contains zero user schema objects and the explicit confirmation flag is present.
It never drops a database, cleans existing objects, or overwrites a non-empty
database.

Modes:
  RESTORE_DATABASE_URL=postgresql://...  Use locally installed psql/pg_restore.
  Otherwise                               Restore into RESTORE_DATABASE_NAME on
                                          the Compose postgres service.

Always use a newly created drill/recovery database, never the active index.
USAGE
}

archive=''
confirmed='false'
while (( $# )); do
  case "$1" in
    --confirm-empty-target) confirmed='true'; shift ;;
    --help|-h) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)
      if [[ -n "$archive" ]]; then echo "Only one snapshot may be restored." >&2; exit 2; fi
      archive="$1"
      shift
      ;;
  esac
done

[[ -n "$archive" ]] || { usage >&2; exit 2; }
[[ "$confirmed" == 'true' ]] || { echo "Refusing restore without --confirm-empty-target." >&2; exit 2; }
[[ -f "$archive" && -s "$archive" ]] || { echo "Snapshot is missing or empty: $archive" >&2; exit 1; }

restore_database_safe_url=''
if [[ -n "${RESTORE_DATABASE_URL:-}" ]]; then
  command -v node >/dev/null || { echo "node is required to handle RESTORE_DATABASE_URL without exposing its password." >&2; exit 1; }
  ambient_pgpassword="${PGPASSWORD:-}"
  mapfile -d '' -t database_url_parts < <(node "$(dirname -- "$0")/redact-database-url.mjs" <<<"$RESTORE_DATABASE_URL")
  if (( ${#database_url_parts[@]} != 2 )) || [[ -z "${database_url_parts[0]}" ]]; then
    echo "Unable to parse RESTORE_DATABASE_URL safely." >&2
    exit 1
  fi
  restore_database_safe_url="${database_url_parts[0]}"
  unset RESTORE_DATABASE_URL PGPASSWORD
  restore_database_password="${database_url_parts[1]:-$ambient_pgpassword}"
  if [[ -n "$restore_database_password" ]]; then export PGPASSWORD="$restore_database_password"; fi
  verify_mode='local'
else
  verify_mode='compose'
fi
SNAPSHOT_VERIFY_MODE="$verify_mode" bash "$(dirname -- "$0")/verify-postgres-snapshot.sh" "$archive"

object_count_sql="WITH user_namespaces AS (SELECT oid, nspname FROM pg_catalog.pg_namespace WHERE nspname = 'public' OR (nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND nspname !~ '^pg_(temp|toast_temp)_')) SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN user_namespaces n ON n.oid=c.relnamespace) + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN user_namespaces n ON n.oid=p.pronamespace) + (SELECT count(*) FROM pg_catalog.pg_type t JOIN user_namespaces n ON n.oid=t.typnamespace) + (SELECT count(*) FROM user_namespaces WHERE nspname <> 'public');"
compose_file="${COMPOSE_FILE:-compose.remote.yaml}"
compose_env_file="${COMPOSE_ENV_FILE:-.env}"
compose=(docker compose)
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then compose+=(--project-name "$COMPOSE_PROJECT_NAME"); fi
if [[ -f "$compose_env_file" ]]; then compose+=(--env-file "$compose_env_file"); fi
compose+=(-f "$compose_file")

if [[ -n "$restore_database_safe_url" ]]; then
  command -v psql >/dev/null || { echo "psql is required for RESTORE_DATABASE_URL mode." >&2; exit 1; }
  command -v pg_restore >/dev/null || { echo "pg_restore is required for RESTORE_DATABASE_URL mode." >&2; exit 1; }
  count="$(psql --dbname="$restore_database_safe_url" --no-psqlrc --tuples-only --no-align --command "$object_count_sql")"
  count="${count//[[:space:]]/}"
  [[ "$count" == '0' ]] || { echo "Refusing restore: target database contains $count user schema objects." >&2; exit 1; }
  pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
    --dbname="$restore_database_safe_url" "$archive"
else
  command -v docker >/dev/null || { echo "docker is required for Compose restore mode." >&2; exit 1; }
  [[ -f "$compose_file" ]] || { echo "Compose file not found: $compose_file" >&2; exit 1; }
  restore_database_name="${RESTORE_DATABASE_NAME:-}"
  [[ -n "$restore_database_name" ]] || { echo "RESTORE_DATABASE_NAME is required in Compose mode." >&2; exit 2; }
  case "$restore_database_name" in
    postgres|template0|template1)
      echo "Refusing restore into reserved database '$restore_database_name'." >&2
      exit 1
      ;;
  esac
  active_database_name="$("${compose[@]}" exec -T postgres sh -eu -c 'printf %s "$POSTGRES_DB"')"
  if [[ "$restore_database_name" == "$active_database_name" ]]; then
    echo "Refusing restore into the active Compose database '$active_database_name'." >&2
    exit 1
  fi
  count="$("${compose[@]}" exec -T -e RESTORE_DATABASE_NAME="$restore_database_name" postgres sh -eu -c \
    'exec psql --username="$POSTGRES_USER" --dbname="$RESTORE_DATABASE_NAME" --no-psqlrc --tuples-only --no-align --command "$1"' sh "$object_count_sql")"
  count="${count//[[:space:]]/}"
  [[ "$count" == '0' ]] || { echo "Refusing restore: target database contains $count user schema objects." >&2; exit 1; }
  "${compose[@]}" exec -T -e RESTORE_DATABASE_NAME="$restore_database_name" postgres sh -eu -c \
    'exec pg_restore --username="$POSTGRES_USER" --dbname="$RESTORE_DATABASE_NAME" --exit-on-error --single-transaction --no-owner --no-privileges' \
    <"$archive"
fi

echo "Snapshot restored successfully into the verified-empty target database."
echo "Run migrations, reconciliation, and application smoke tests before promoting this database."
