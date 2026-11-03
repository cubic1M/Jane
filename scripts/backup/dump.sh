#!/usr/bin/env bash
# Nightly encrypted dump of Jane's database (docs/security/backups.md). Encrypts to a public key, so
# the machine running this can't read its own backups. Prints file names and sizes, never the
# database address. Run it from a founder's machine: agents never point anything at production.
#
#   BACKUP_DATABASE_URL   direct (not pooled) connection string. Required.
#   BACKUP_AGE_RECIPIENT  age public key (age1...). Required.
#   BACKUP_DIR            where dumps go. Default: ~/jane-backups
#   BACKUP_KEEP           how many dumps to keep. Default: 14
#   HEALTHCHECKS_PING_KEY optional: pings jane-backup, so a night without a dump raises an alarm.
#   HEALTHCHECKS_URL      optional: defaults to https://hc-ping.com
set -euo pipefail

die() { echo "dump: $*" >&2; exit 1; }

[ -n "${BACKUP_DATABASE_URL:-}" ] || die "BACKUP_DATABASE_URL isn't set"
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] || die "BACKUP_AGE_RECIPIENT isn't set"
case "$BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *) die "BACKUP_AGE_RECIPIENT isn't an age public key" ;;
esac
command -v pg_dump >/dev/null || die "pg_dump isn't installed"
command -v age >/dev/null || die "age isn't installed"

BACKUP_DIR="${BACKUP_DIR:-$HOME/jane-backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
case "$BACKUP_KEEP" in
  '' | *[!0-9]* | 0) die "BACKUP_KEEP must be a whole number above 0" ;;
esac

ping() {
  [ -n "${HEALTHCHECKS_PING_KEY:-}" ] || return 0
  curl -fsS -m 5 -o /dev/null \
    "${HEALTHCHECKS_URL:-https://hc-ping.com}/${HEALTHCHECKS_PING_KEY}/jane-backup${1}?create=1" || true
}

umask 077
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
final="$BACKUP_DIR/jane-$stamp.dump.age"
partial="$final.partial"

fail() {
  rm -f "$partial"
  ping /fail
  die "failed, nothing kept from this run"
}
trap fail ERR
ping /start

# The password goes through the environment, so it isn't on the process list.
PGPASSWORD=$(node -e 'console.log(decodeURIComponent(new URL(process.env.BACKUP_DATABASE_URL).password))')
PGHOST=$(node -e 'console.log(new URL(process.env.BACKUP_DATABASE_URL).hostname)')
PGPORT=$(node -e 'console.log(new URL(process.env.BACKUP_DATABASE_URL).port || 5432)')
PGUSER=$(node -e 'console.log(decodeURIComponent(new URL(process.env.BACKUP_DATABASE_URL).username))')
PGDATABASE=$(node -e 'console.log(new URL(process.env.BACKUP_DATABASE_URL).pathname.slice(1))')
PGSSLMODE=$(node -e 'console.log(new URL(process.env.BACKUP_DATABASE_URL).searchParams.get("sslmode") || "prefer")')
export PGPASSWORD PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE
# verify-full (what Neon's address asks for) needs certificates to check against.
case "$PGSSLMODE" in
  verify-*) export PGSSLROOTCERT="${PGSSLROOTCERT:-system}" ;;
esac

started=$SECONDS
pg_dump --format=custom --no-owner --no-privileges | age -r "$BACKUP_AGE_RECIPIENT" >"$partial"
[ -s "$partial" ] || fail
mv "$partial" "$final"
(cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$final")" >"$(basename "$final").sha256")

# Oldest go first, keeping the newest BACKUP_KEEP.
ls -1 "$BACKUP_DIR"/jane-*.dump.age | sort -r | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
done

ping ""
echo "dump: $(basename "$final"), $(du -h "$final" | cut -f1), $((SECONDS - started))s"
