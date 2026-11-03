# The access proof

Row-level security (`docs/security/rls.md`) stops a scoped query reaching someone else's rows, but
calls on the raw client skip it, and no test walked every way into the app as the wrong person. This
is that test, after [OWASP's authorization testing matrix](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Testing_Automation_Cheat_Sheet.html):
a declared list of who may reach what, then an attack on every entry. Three checks:

| Check | What fails | Where it runs |
| --- | --- | --- |
| Route inventory (`src/security/access-proof/access-map.test.ts`) | A route, server action or page not declared in `src/config/access-map.ts` | Unit tests |
| Attack suite (`src/security/access-proof/access.proof.test.ts`) | Someone getting in, reading a planted marker or changing another person's rows | The "Access proof" CI job, `npm run test:access` |
| Lint rule `jane/no-raw-db` (`src/security/lint/no-raw-db.mjs`) | A new use of the raw database client | `npm run lint` |

## If one of them failed on your change

**"New route, action or page: add it".** Add a line to `src/config/access-map.ts` saying who it's for:
`"signed-in"`, `"admin"`, `"cron"`, `"webhook"`, or `public_("why it's safe")`. A link that carries
its own secret (`/s/[token]`) is public, and the reason says so.

**"New raw database client use".** Query through `scopedFor` from `src/lib/db-scoped.ts`. If the code
truly works across people (cron, admin, retention, sign-in), raise that file's number in
`src/config/raw-db-allowlist.json` and say why in the pull request; a reviewer reads that line. The
list is what was there when the rule came in, counted per file, so it only ever goes down: a file that
uses the client less must lower its number. Don't turn the rule off in a file: a test fails on that.

**"leak", "wrote to the victim's rows", "linked a row", "not refused" in the attack.** Believe it first.
The failure names the call and what it saw; `test-results/access-proof.json` (a CI artifact on failure)
has them all. Fix the route. A write that really is meant (an emailed link marking its own digest
opened) goes in `ALLOWED_WRITES` in the test, with the reason.

## How the attack works

- **One id fits everything.** Every owned table gets a row of the victim's with the same id, a real
  cuid-shaped string. So `accountId`, `findingId` and `id` all name a real row of theirs, with no list
  of which parameter means what, and a table added tomorrow is covered without touching the test.
- **The rows.** A real demo-bank sync comes first, so rows have the shape the code expects: a row the
  code chokes on would hide a leak behind an error. Tables the sync doesn't reach get a row built from
  the database's catalog. Words a person could read carry a marker unique to the victim (name, email,
  titles, notes, JSON).
- **Every way in, found on disk.** Route handlers, server actions (files named `*actions.ts` and any
  file starting `"use server"`) and pages. A handler gets a real `Request`; an action gets arguments
  built from its signature, read from the source, with a form that answers any field; a page is
  rendered far enough to see what it would send to the browser.
- **What counts as a failure** (`verdict.ts`, tested on its own): the marker anywhere in a body, return
  value, redirect, error, email or outgoing request; any write on the victim's rows (triggers on every
  owned table, so none escapes); the attacker's own row now pointing at the victim's by an id column;
  a signed-in, admin, cron or webhook door that didn't refuse; a trial person in analytics or causing
  an email.
- **Who attacks.** Nobody; a stranger with real data (a CSV account next to the demo bank, so they get
  what a real account gets, not demo advice), using the victim's ids; a trial person against a real
  person; a real person against a trial person; a household partner against the other partner, then
  again after leaving; and cron and webhook routes with a wrong secret.
- **It checks itself.** The victim reading their own pages must find their marker on at least 100 of
  them (117 of 129 when written), so its absence for a stranger means something; a partner must find
  what was shared; and `fixtures/broken-surfaces.ts`, deliberately broken on purpose, must fail each
  way it's broken. If the suite goes blind, these fail first. It also fails if fewer ids reach the
  database than the floor it declares, so a change that stops the attacks getting past validation is
  noticed.
- **Nothing leaves the machine.** Outgoing requests and sockets to anywhere but localhost are blocked,
  and it refuses to run on any database that isn't local.

## Running it

```bash
ACCESS_PROOF=1 TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/your_scratch_db npx vitest run src/security/access-proof/access.proof.test.ts
```

Use a database of your own, migrated and with `node scripts/rls-protect.mjs <url>` run, set to UTC.

## What it doesn't prove

- **That the attack got past validation everywhere.** An id only reaches the database if the arguments
  get that far. The run prints how many calls did, per kind. An action that rejects the made-up values
  before its query is safe from this attack, not proven safe. Its scoped queries are still covered by
  `src/lib/rls.integration.test.ts`.
- **Sign-in itself.** Auth.js can't load outside Next.js, so its session lookup is replaced by the same
  adapter read and payload. `e2e/auth.spec.ts` covers the real one.
- **The proxy.** `src/proxy.ts` isn't in the path, so these calls are never rate limited. An admin page
  must refuse by itself here, and does (`requireAdmin`).
- **Only what's reachable with one kind of id.** Ids a route reads from inside JSON it stores, or
  two-step flows (a token issued by one call and used in the next), get the victim's row id, not a real
  token.
- **That a declaration is right.** A route declared `public_` isn't checked for refusing anyone, only
  for leaking a marker. The reason is what a reviewer has to read.
- **A chat answer.** Claude isn't called in tests, so what the model would say isn't tested here; the
  data tools it reads through are scoped (`src/lib/jane-agent`).
- **Calls on a client passed in with no default.** The lint rule counts uses of the raw client from where
  it's imported; a function taking `client: PrismaClient` with no default isn't counted, its caller is.
