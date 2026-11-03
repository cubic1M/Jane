#!/usr/bin/env bash
# The timed restore drill (docs/security/backups.md): decrypts a dump into an empty, throwaway
# database, checks every table arrived, and prints how long it took. It refuses anything that could
# be production: the target must be empty, and on this machine unless you say otherwise.
#
#   restore-drill.sh <dump.age> <age identity file>
#
#   DRILL_DATABASE_URL         the empty database to restore into. Required.
#   DRILL_TARGET_IS_THROWAWAY  "yes" allows a target that isn't on this machine (a new Neon branch).
set -euo pipefail

die() { echo "drill: $*" >&2; exit 1; }

[ "$#" -eq 2 ] || die "usage: restore-drill.sh <dump.age> <age identity file>"
dump=$1
identity=$2
[ -n "${DRILL_DATABASE_URL:-}" ] || die "DRILL_DATABASE_URL isn't set"

url_part() {
  URL_TO_READ="$1" node -e "
    try { console.log(new URL(process.env.URL_TO_READ).$2) } catch { console.log('') }"
}
target_host=$(url_part "$DRILL_DATABASE_URL" hostname)
[ -n "$target_host" ] || die "DRILL_DATABASE_URL isn't a database address"

for name in DATABASE_URL DIRECT_URL BACKUP_DATABASE_URL; do
  value="${!name:-}"
  [ -n "$value" ] || continue
  [ "$value" != "$DRILL_DATABASE_URL" ] || die "the target is $name. Refusing."
  [ "$(url_part "$value" hostname)" != "$target_host" ] || die "the target is on the same host as $name. Refusing."
done

case "$target_host" in
  localhost | 127.0.0.1 | '[::1]') ;;
  *)
    [ "${DRILL_TARGET_IS_THROWAWAY:-}" = "yes" ] ||
      die "the target isn't on this machine. If it's a new throwaway branch, set DRILL_TARGET_IS_THROWAWAY=yes."
    ;;
esac

[ -f "$dump" ] || die "no such dump"
[ -f "$identity" ] || die "no such identity file"
command -v age >/dev/null || die "age isn't installed"
command -v pg_restore >/dev/null || die "pg_restore isn't installed"
command -v psql >/dev/null || die "psql isn't installed"

if [ -f "$dump.sha256" ]; then
  (cd "$(dirname "$dump")" && shasum -a 256 -c "$(basename "$dump").sha256" >/dev/null) ||
    die "the dump doesn't match its checksum"
fi

query() { psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

tables=$(query "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
[ "$tables" = "0" ] || die "the target has $tables tables. It must be empty. Refusing."

# Policies name roles that a dump made with --no-owner doesn't bring along.
for role in jane_rls jane_app; do
  query "DO \$\$ BEGIN CREATE ROLE $role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$" >/dev/null
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
started=$SECONDS
age -d -i "$identity" -o "$work/dump" "$dump"
# A newer pg_dump writes settings an older server doesn't know, and the restore stops on them.
dumped_by=$(pg_restore --list "$work/dump" | sed -n 's/^; *Dumped by pg_dump version: \([0-9]*\).*/\1/p')
target_major=$(($(query "SHOW server_version_num") / 10000))
[ "${dumped_by:-0}" -le "$target_major" ] ||
  die "dumped by pg_dump $dumped_by, but the target runs Postgres $target_major. Use a target at least as new, or dump with pg_dump $target_major."
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DRILL_DATABASE_URL" "$work/dump"
elapsed=$((SECONDS - started))

expected=$(pg_restore --list "$work/dump" | grep -c ' TABLE DATA ' || true)
restored=$(query "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
[ "$expected" -gt 0 ] || die "the dump holds no tables"
[ "$restored" = "$expected" ] || die "the dump holds $expected tables but $restored arrived"

migrations=$(query "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
users=$(query "SELECT count(*) FROM users")
[ "$migrations" -gt 0 ] || die "no finished migrations arrived"

echo "drill: passed in ${elapsed}s. $restored tables, $migrations migrations, $users people."
echo "drill: write this down in docs/beta-checklist.md: $(date -u +%Y-%m-%d), ${elapsed}s, $(du -h "$dump" | cut -f1) dump."
