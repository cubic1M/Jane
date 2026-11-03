# Backups and the restore drill

Two layers, because they fail differently:

- **Neon's history** gets you back from a bad migration or a bad delete in minutes, within its
  window (`docs/security/vendors.md`). It's in the same company as the database.
- **A nightly encrypted dump** is a separate copy, kept somewhere else, and works if the Neon
  project itself is lost.

A backup nobody has restored isn't proof of anything, so the drill matters as much as the dump.

Only a founder runs these against production. Claude sessions never do.

## What you need (once)

- **Postgres tools the same major version as the database, or newer than it.** `pg_dump`,
  `pg_restore` and `psql`. Check the database's version with `SHOW server_version;` in Neon's SQL
  editor. The drill's target must be at least as new as the `pg_dump` that made the dump, or the
  restore stops. The drill checks this and says so.
- **`age`,** for encryption: <https://github.com/FiloSottile/age/releases>.
- **A key pair.** Run this once and keep the file **off the machine that makes the backups**, in
  your password manager:

  ```bash
  age-keygen -o jane-backup-key.txt
  ```

  It prints the public key (`age1...`). The nightly job only needs that, so a stolen backup machine
  can't read its own backups. If you lose the key file, the backups are gone too.

## The nightly dump

```bash
BACKUP_DATABASE_URL='<Neon direct connection string, not -pooler>' \
BACKUP_AGE_RECIPIENT='age1...' \
scripts/backup/dump.sh
```

It writes `~/jane-backups/jane-<time>.dump.age` and a checksum, keeps the newest 14 (`BACKUP_KEEP`),
and prints only the file name and size. With `HEALTHCHECKS_PING_KEY` set it also pings `jane-backup`,
so a night with no dump raises an alarm.

**Run it nightly with launchd** on a machine that's on at night, and turn on Healthchecks so you
hear when it isn't. A laptop that's asleep misses the run, which is why the alarm matters. Keep the
environment variables in a file only you can read, not in the job's definition.

**Keep a copy elsewhere.** A folder synced to your own cloud storage works: the files are encrypted.
Don't commit them to this repository or attach them to a workflow run, since this repository is
public.

**Before turning this on: deleted people.** "Delete all my data" can't reach a dump already made, so
someone's rows can stay in a backup for 14 days after they delete their account. The privacy page
doesn't say that yet, so it needs counsel's wording first. After any restore, delete again whoever
asked to be deleted since that dump: `audit_log` keeps the ids.

## The timed drill

Make an empty database to restore into, on your own machine or as a new Neon branch you'll throw away:

```bash
DRILL_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/drill' \
scripts/backup/restore-drill.sh ~/jane-backups/jane-<time>.dump.age jane-backup-key.txt
```

It checks the file's checksum, decrypts, restores, checks every table arrived and prints how long
it took. Write the date, time and size in `docs/beta-checklist.md`. For a Neon branch, also set
`DRILL_TARGET_IS_THROWAWAY=yes`.

It refuses a target that has tables in it, is the same address or host as `DATABASE_URL`,
`DIRECT_URL` or `BACKUP_DATABASE_URL`, or isn't on this machine without that setting.

Then look for yourself: open a few tables, and delete the throwaway database. The drill can't tell
you the numbers are the right ones.

## What this was tested on

On 2026-11-03, on sample data only, never production, with Postgres 16 tools and age 1.3.2. The
source was a scratch database of 189 tables, 214 migrations, 200 sample people and 20,000 findings,
and the target was a brand new Postgres cluster.

| Check | Result |
| --- | --- |
| Restore | Passed in 7s. Same counts, same checksum across all 20,000 rows, same 318 row-level security policies |
| Readable text in the dump | None |
| Wrong key | Refused, nothing restored |
| A changed byte in the file | Refused, nothing restored |
| A checksum that doesn't match | Refused |
| A target with tables in it | Refused |
| A target that's `DIRECT_URL`, or off this machine | Refused |
| Dump from a newer `pg_dump` than the target | Refused, saying which versions |
| Keeping the newest N | Older files removed |
| Heartbeats | start and success on a good run, start and fail on a bad one, with no partial file left |

**Not tested, because it needs production:** how long the real database takes, and whether a dump
from Neon restores cleanly somewhere that isn't Neon. Neon-specific extensions could stop it, and
only the first real drill will show that.
