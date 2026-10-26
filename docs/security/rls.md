# Row-level security

A second safety net under the app's own scoping. The app already adds the signed-in person's id
to every query on their data (`scopedFor` in `src/lib/db-scoped.ts`). With row-level security
(RLS) the **database itself** also checks: a query made for Alice gets only Alice's rows, even if
the app code asks for Bob's, forgets the filter, or uses raw SQL.

## In plain words

- Think of the database as a filing room. Until now, the clerk (our code) promised to fetch only
  your folders. Now the room has a lock: when the clerk works for you, the door opens only to your
  folders, whatever the clerk asks for.
- Nightly jobs, admin pages, data retention and Try Jane clean-up still need the whole room. They
  use the app's own key, as before, and never the per-person door.
- If the lock can't be installed on some database (it needs permission to create a database
  role), the app keeps working with the clerk's promise alone and logs that the lock is off.
  Setting `RLS_REQUIRED=1` turns that into a hard failure instead.

## How it works

1. **A role nobody logs in as.** The migration
   (`prisma/migrations/20270408000000_row_level_security`) creates `jane_rls`: `NOLOGIN`,
   `NOBYPASSRLS`, not a superuser. The app's own database role is made a member, so it can switch
   to it.
2. **Policies on every user-owned table.** Each table with a `user_id` gets
   `ENABLE ROW LEVEL SECURITY` and a policy for `jane_rls`:
   `user_id = current_setting('app.user_id', true)`, for reads (`USING`) and for writes
   (`WITH CHECK`, so a row can't be written for, or moved to, someone else). With no id set,
   `jane_rls` sees nothing.
3. **Each scoped query is a short transaction as the person.** `scopedFor` sends every query as
   a transaction that starts by switching to the person:

   ```sql
   BEGIN;
   SELECT set_config('role', 'jane_rls', true), set_config('app.user_id', $1, true);
   -- the query Prisma built, already filtered by user_id
   COMMIT;
   ```

   The `true` makes both settings **transaction-local**: they end at `COMMIT` or `ROLLBACK`. That
   matters because production goes through Neon's pooler (pgbouncer in transaction mode), which
   hands a connection to someone else after every transaction. A session-level `SET` could leak
   one person's id into the next person's query; a transaction-local one can't. The person's id
   is sent as a parameter, never pasted into the SQL.

   Written that way it costs four network round trips instead of one, which doubled page times
   in the first measurement. So the app's connection pool (`src/lib/rls-pg.ts`, used by
   `src/lib/db.ts`) sends the switch **in the same network flight** as the query, with one Sync
   after both. Postgres runs everything before a Sync as one transaction, so the switch still
   ends with the query, exactly as at `COMMIT`. A read's statements go one flight each, each with
   its own switch (reads were never one transaction). A write keeps Prisma's whole transaction,
   so a nested write is still all-or-nothing: `BEGIN` and the switch go with its first statement,
   and the rest, `COMMIT` included, as Prisma wrote them. This changes how statements travel,
   never what runs: over a plain pg connection (tests, scripts) the same statements go one by one
   and mean the same. `src/lib/rls.integration.test.ts` runs every check both ways.
4. **Interactive transactions** (`scopedFor(...).transaction(...)`, used by decisions and a few
   flows) switch once at the start; every statement inside, raw SQL included, is checked.
   `asUserTransaction` in `src/lib/rls.ts` does the same for any other code that needs it.
5. **The rule is worked out from the catalog**, not from a hand-kept list
   (`jane_rls_plan()` in the migration). After every `prisma migrate deploy`,
   `scripts/rls-protect.mjs` runs `jane_rls_protect_all()` (in `vercel-build` before production
   builds, and in CI after migrations), so a table added by a later migration is protected before
   the code that uses it goes live. Each table is its own short step that waits at most 3 seconds
   for a lock, so a busy table at deploy time is retried rather than stalling traffic; the deploy
   fails if one is still left after five tries.

## What each table gets

| Kind | Tables | `jane_rls` may |
| --- | --- | --- |
| Owned (has `user_id`) | 151 tables: `accounts`, `transactions`, `plaid_items`, `findings`, `decisions`, `actions`, `jane_messages`, every insurance, loan, tax, investing and paper-account table, `sessions`, `auth_accounts`, `mfa_backup_codes`, `household_members`... (the full list is `SELECT * FROM jane_rls_plan() WHERE kind = 'owner'`) | read and write the person's own rows |
| Owned through a parent | `gifts` (through `gift_links`) | read and write rows whose parent is the person's |
| The person | `users` | read their own row |
| Shared by a household | `households` | read the one they belong to |
| Reference data | `referral_partners` | read every row (no personal data) |
| System records | `audit_log`, `analytics_events` | nothing |
| Everything else | `jobs`, `verification_tokens` (magic links), `rate_limits`, `invite_codes`, `waitlist`, `error_events`, `merchants`, market data, `_prisma_migrations`... | nothing |

Any table that has a `user_id` column is "owned" automatically. A table without one that points
at an owned table through a single-column foreign key is "owned through a parent" automatically
(if it points at several, every parent must be visible). Anything else gets no access until the
rule in `jane_rls_plan()` says otherwise.

### Why the audit log and analytics get nothing

Both are the system's record of what happened, written by `logAudit` (`src/lib/audit.ts`) and
`track` (`src/lib/analytics.ts`) through the app's own role, never through `scopedFor`. Letting a
per-person query read them would add nothing a person needs (their activity page reads through
the app's role), and letting one write them would let a bug forge or rewrite history. So the
per-person role can neither read nor change them. `audit_log` has no `user_id` at all (it has
`actor_id` and a target), and `analytics_events.user_id` is optional. Making them append-only for
the app's own role too (no `UPDATE`/`DELETE`, retention through a narrow function) is a separate
later step, since retention deletes old rows today.

## The bypass

There is one, and it is a role, not a setting: **the app's own login role**, which is not
`jane_rls`. It is what `db` from `src/lib/db.ts` uses directly, and it is what these use:

- cron routes (`src/app/api/cron/*`, behind `CRON_SECRET`), which work across everyone
- admin pages (`src/app/admin/*`, behind `ADMIN_EMAILS` and two-factor)
- retention (`src/lib/retention.ts`) and Try Jane clean-up (`src/lib/trial.ts`)
- sign-in (the Auth.js adapter), household sharing (`sharedReadFor`), metrics, the demo bank sync

There is deliberately **no** `app.bypass_rls`-style switch for `jane_rls`: a query running as a
person can't turn the policies off by setting something (a test proves it). Tables have RLS
enabled but not forced, and every policy is either `TO jane_rls` or the explicit `jane_system`
policy (`current_user <> 'jane_rls'`), which keeps every other role's access exactly as it was
whether or not that role owns the tables.

## What this protects against, and what it doesn't

It protects against the mistakes that cause most data leaks in apps like this: a query on the
scoped client whose filter is wrong, a relation or `include` that reaches someone else's rows, a
new helper that forgets the user id. Inside a person's transaction the database answers only
with their rows.

It does not, yet, protect:

- **Code that skips `scopedFor` entirely** and uses `db` directly. About 230 such calls in 79
  files today (household sharing, sign-in, metrics, the paper and practice autopilots, the demo
  sync, cron work). They run as the app's own role, as before. See "Next step".
- **Arbitrary SQL from an attacker.** The role switch is a `SET ROLE`: code running inside the
  transaction could `RESET ROLE`. Our SQL is built by Prisma with parameters, never from user
  text, so this is a guard against our own mistakes, not a sandbox for hostile SQL.
- **The database's owner role itself** (migrations, Neon's console), by design.

## Next step: deny by default

1. Move each direct `db` call on a user-owned table to `scopedFor`, or, where it truly works
   across people (cron, admin, retention, trial clean-up, metrics, sign-in), to a named
   `systemDb` helper that records why.
2. Give the app a login role of its own in Neon (`jane_app`, `NOBYPASSRLS`, not the owner), with
   the same rule: no rows unless `app.user_id` is set or it is a `systemDb` transaction.
3. Point `DATABASE_URL` at it and set `RLS_REQUIRED=1`. Then forgetting to scope returns
   nothing, everywhere.

## Performance

Measured on a production build (`next build`, `next start`) with a Try Jane sample person
("family"), through a proxy that adds 1 ms each way to every database round trip (about what
Vercel to Neon in the same region costs). Each page was requested twice to warm up, then timed 7
times, in 4 rounds alternating which mode went first: 28 timings per page and mode. "Off" is the
same build with the switch failing, so scoped queries run exactly as before this change.

| Page | RLS off (median) | RLS on (median) | Cost |
| --- | --- | --- | --- |
| `/home` | 276 ms | 307 ms | +31 ms (+11%) |
| `/money` | 42 ms | 45 ms | +3 ms (+7%) |
| `/taxes` | 123 ms | 136 ms | +13 ms (+11%) |
| `/plan` | 218 ms | 226 ms | +8 ms (+4%) |
| `/insurance` | 110 ms | 119 ms | +9 ms (+9%) |

Before the one-flight pool, the plain four-round-trip transactions cost +90% to +160% on the same
pages (`/home` 300 to 580 ms, `/insurance` 115 to 290 ms). What is left is a write's extra round
trip (its `COMMIT`), Prisma's own work per transaction, and the policies, a cheap filter on rows
already found through the `user_id` index the app's own filter uses. Repeated reads within one
render are still shared (`src/lib/read-memo.ts`), as are background work's (`src/lib/read-cache.ts`).

Scoped transactions wait up to 60 s for a free connection and may run 60 s
(`SCOPED_QUERY_TRANSACTION`): Prisma's transaction defaults (2 s and 5 s) failed busy test runs
where a plain query would just have queued.

## Checking it

- `src/lib/rls.integration.test.ts`: every user-owned table is protected; Alice, with her id set,
  sees none of anyone else's rows in any of them through raw SQL, and can't update, delete,
  insert for or take over Bob's; every scoped helper returns, updates and deletes nothing of
  Bob's; no setting lifts the policies; with no id set nothing is visible; the app's role keeps
  full access; and a pooled connection carries nothing over after a scoped transaction,
  committed or rolled back.
- `src/lib/rls.test.ts`: the fallback when the role is missing, and `RLS_REQUIRED=1`.
- `src/lib/rls-pg.test.ts`: what the app's pool sends for each statement Prisma writes.
- The rest of the suite (cron, trial clean-up, retention, admin, demo bank) runs with RLS on, in
  CI and against a scratch database set up like Neon (a non-superuser owner with `BYPASSRLS`).
- In production, without touching the database: **`/admin/health`** (admins only) has a
  "Row-level security" line, read live from the database's catalog
  (`src/lib/rls-coverage.ts`). It shows "On: N of N user-owned tables covered · this server
  switches to it", or an `[ERROR]` box naming each table that isn't covered. "Every table" lists
  each one with RLS on or off and its policy count. "This server switches to it" means the page
  just tried the same switch every scoped query makes and the database answered as `jane_rls`.
- The daily health check (`reportMissedJobs` in `src/lib/health.ts`, from the digest and Plaid
  sync crons) emails `ADMIN_EMAILS` once per lapse if coverage ever drops ("Row-level security
  has a gap"), and again only after it has been whole in between.
- `/admin/errors` (and the Vercel logs) show "Row-level security is off" if the switch ever
  fails at runtime.

## Adding a table

Nothing to do for a table with a `user_id`, or one that hangs off one: the next deploy protects
it. A table that people's rows point at and that should be readable by the scoped client
(like `referral_partners`) needs a line in `jane_rls_plan()` (a new migration with
`CREATE OR REPLACE FUNCTION`). Changing a policy that already exists also needs a migration
(`DROP POLICY`, then `jane_rls_protect_all()` recreates it).
