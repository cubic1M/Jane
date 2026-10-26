# Architecture

Jane is one Next.js app (App Router, TypeScript in strict mode) on Vercel, with Postgres
through Prisma. It reads a person's money (Plaid, CSV or OFX imports, or the demo bank),
finds what they're losing or could do better, and brings each finding to them: as a card to
decide on, and in a chat with Jane, which Claude writes from Jane's own numbers. This page is
the map: where things live, how data moves, the rules every change keeps, and how jobs and
deploys run. The product spec is [docs/spec.md](spec.md); the rules in short are in
[CLAUDE.md](../CLAUDE.md).

## Folders

| Folder | What lives there |
| --- | --- |
| `src/app` | Pages and API routes. Each area has a page (`/money`, `/loans`, `/insurance`, `/investments`, `/taxes`, `/plan`, `/report`, `/jane`, `/home`) with its own `actions.ts` (server actions). `src/app/api` holds the routes: `cron/*` (scheduled jobs), `plaid/*` (link, exchange, webhook), `chat/*` (the chat's send and feed), `auth` (Auth.js), and a few more. `src/app/admin` is the team's back office. |
| `src/config` | Every threshold, rate, limit and label, each with where it comes from. Code never inlines a number that belongs here (detection's live in `src/config/detection.ts`). `hidden-pages.ts` lists the pages the read-only beta hides. |
| `src/data-sources` | Getting data in: `plaid/` (normalizing Plaid's accounts, transactions, liabilities and holdings), `csv/` and `ofx/` (imports, parsed in memory, never stored raw), `demo/` (the demo bank and the sample people), plus merchant clean-up and de-duplication. All sources share the types in `types.ts`. |
| `src/categorize` | Categorizing transactions: rules first, then Claude for the merchants rules can't place (names only, never amounts). |
| `src/detection` | The money-found engine: subscription and recurring-stream detection, paydays, overlaps, unusual charges, and the rules in `rules/` that produce findings (`engine.ts` runs them all). |
| `src/detectors` | The proactive detectors, one file per sector (`debt`, `insurance`, `investing`, `money`, `planning`, ...): each turns a person's data into suggestions with a confidence percentage. |
| `src/planning` | Pure planning math with no database: loans, taxes, retirement, the investing catalog, what-ifs. Easy to unit-test. |
| `src/insights` | Read-only views built from data: what's coming up, deadlines, life signals. |
| `src/lib` | Everything else server-side, by feature (`afford.ts`, `bnpl.ts`, `goals.ts`, ...), plus the shared plumbing: `db.ts` and `db-scoped.ts` (database access), `session.ts` (who is signed in), `audit.ts`, `analytics.ts`, `guardrails.ts`, `jobs.ts`, `rate-limit.ts`. Larger features have folders: `jane-agent/` (the chat), `agent/` (acting for people: mail, calls, switches), `plaid/` (sync and tokens), `investments/`, `insurance/`, `paper/` and `practice/` (simulated investing), `area-pages/` and `hubs/` (what each area page shows). |
| `src/components` | Shared React components: the app header, area trees, cards, the side chat, loading bars. |
| `src/generated` | The Prisma client (generated; not committed by hand). |
| `prisma` | `schema.prisma` and the migrations. |
| `e2e` | Playwright tests, run against a production build. |
| `docs` | The spec, design notes, the detectors catalog, legal drafts and setup guides. |

## How data flows

```
Plaid / CSV / OFX / demo bank
        │  src/data-sources (normalize)        src/lib/plaid/sync.ts (Plaid webhook or daily cron)
        ▼
accounts, transactions, liabilities, holdings  (Postgres, money as integer cents, times in UTC)
        │  src/categorize
        ▼
src/detection/engine.ts ──► findings (money found: subscriptions, fees, idle cash, ...)
src/detectors/*        ──► suggestions, each with a confidence %
src/lib/controller.ts  ──► the nightly run: every sector's checks, one log per person
        │
        ▼
src/lib/jane-agent/snapshot.ts  (the person's numbers, in one place)
        │
        ├──► cards and pop-ups (src/lib/jane-agent/popups.ts, /report, /plan)
        └──► the chat (src/lib/jane-agent/typing.ts → claude.ts, with tools over the snapshot)
                │  every Claude-written sentence passes src/lib/guardrails.ts
                ▼
        a yes on a card ──► an action (src/lib/agent, the jobs queue) or, for a real account
                            in the read-only beta, the steps for the person to do it themselves
```

- **Getting data in.** A bank linked through Plaid syncs on its webhook and again daily
  (`/api/cron/plaid-sync`). A CSV or OFX upload is parsed in memory, shown for a check, then
  saved. The demo bank fills the same tables from `src/data-sources/demo`.
- **Finding things.** `runDetection` runs every rule on the person's data and saves findings;
  running it twice on the same data changes nothing. The detectors in `src/detectors` cover
  the sectors (debt, insurance, investing, taxes, planning) and feed the ranked list of what
  matters most.
- **Bringing it to the person.** The snapshot gathers the person's numbers. Pages read it
  through `src/lib/area-pages` and `src/lib/hubs`. The chat answers typed questions with
  Claude, writing from tools over the same numbers; buttons, flows and a few exact commands
  are answered by rules, for free. When Claude can't answer (no key, a cap, a timeout, a
  guardrail block), the rules answer from the same data stands in.
- **Acting.** A yes is recorded as a decision. For the demo bank and concierge accounts it
  becomes an action that the agent (`src/lib/agent`) or the team completes. Real accounts in
  the read-only beta get "Show me how" (the steps and drafts) and do it themselves.

## Rules every change keeps

- **User scoping.** Every user-owned table has `user_id`, and is read and written through
  `scopedDb()` / `scopedFor(userId)` in `src/lib/db-scoped.ts`, which adds the user's id to
  every query. Asking for someone else's row matches nothing.
- **Audit and analytics.** Every sensitive event (sign-in, linking or removing a bank, admin
  changes, exports) goes through `logAudit` (`src/lib/audit.ts`, the `audit_log` table), with
  no secrets in its metadata. Funnel events go through `track` (`analytics_events`, and
  PostHog when configured).
- **Secrets.** Every secret comes from an env var, listed in `.env.example`. Plaid access
  tokens are stored encrypted (AES-256-GCM with `TOKEN_ENCRYPTION_KEY`) and never logged or
  returned.
- **Guardrails.** Claude's text never gives investment, tax or legal advice:
  `checkGuardrails` in `src/lib/guardrails.ts` checks every piece before anyone sees it, and
  what fails is replaced with plain template text.
- **Advice mode.** `adviceMode(userId)` (`src/lib/advice-mode.ts`) is true only when every
  account is the demo bank (in production, only with `DEMO_ADVICE=1`). Then recommendations
  may be shown, checked with the stricter "demo_advice" guardrail profile and labelled "Demo
  advice: sample data, not financial advice". Real accounts never get advice
  (`REAL_ACCOUNT_ADVICE` in `src/config/advice.ts` stays false).
- **Trial people.** Try Jane's sample people have ids starting `trial_`
  (`src/lib/trial-ids.ts`). They are sample data: never emailed, never contacting a real
  company, never in analytics or metrics, and deleted after `TRIAL_HOURS`.
- **The paper account.** `src/lib/paper` and `src/lib/practice` are simulated money only: no
  real order, broker or account, ever. Prices are real and free (Alpaca, else Yahoo).
- **Chat spend.** Claude's chat answers are capped per person per day and for everyone per
  month (`src/config/agent-chat.ts`, `src/lib/jane-agent/spend.ts`); `/admin/chat` shows
  today's spend and the limit hits.
- **Config, not constants.** Thresholds and rates live in `src/config`, with their source.

## Scheduled jobs

Vercel Cron calls these routes (`vercel.json`), each checking `Authorization: Bearer
$CRON_SECRET`:

| Route | When (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/plaid-sync` | 10:00 daily | Syncs stale Plaid items, removes inactive ones (after a warning), snapshots balances for net worth, raises deadline reminders, queues each person's nightly controller run, and works through due jobs. |
| `/api/cron/digest` | 15:00 daily | The weekly digest for anyone whose Monday has arrived, and due jobs. |
| `/api/cron/market-history` | 09:00 daily | Adds the day's closes for the model ETFs from Alpaca (read only). |
| `/api/cron/strategy-eval` | 09:30 daily | Replays every strategy over the stored closes and saves each level's choice. |
| `/api/cron/practice-scan` | 21:30 daily | Scans every practice portfolio and runs its autopilot, in the practice ledger only. |
| `/api/cron/paper-run` | 22:00 daily | Values every paper account at the day's closes and leaves its trades in the trade pop-up. |

Slow work that can fail goes through the jobs queue (`src/lib/jobs.ts`, the `jobs` table):
claimed with `FOR UPDATE SKIP LOCKED`, retried with a growing wait, and shown on
`/admin/jobs` when it gives up.

## Tests and CI

- `npm test` runs Vitest. Unit tests sit next to their code (`*.test.ts`). Tests named
  `*.integration.test.ts` run against a real, migrated Postgres when `TEST_DATABASE_URL` is
  set (CI always sets it).
- `npm run test:e2e` runs Playwright. Signed-in tests need `E2E_DATABASE_URL` pointing at a
  scratch database; CI runs them on a production build, in three shards, on a 375px phone
  and a desktop.
- No test calls Claude for real: the chat runs without a key (rules answers) or with a fake
  client.
- `.github/workflows/ci.yml` runs lint, format, typecheck, the unit shards, the e2e build and
  shards, a dependency audit and a secret scan on every push and PR. The merge train
  (`merge-train.yml`) lands an auto-merge PR once it has passed and is up to date.

## Deploys

- Production is on Vercel. Git deploys are off (`"git": { "deploymentEnabled": false }` in
  `vercel.json`): nothing deploys just because a commit landed.
- Main is deployed by a deploy loop the team runs, which ships the newest commit on `main`
  that passed CI (unit and e2e), within a daily cap. A manual `vercel deploy --prod` is for
  emergencies only.
- The `vercel-build` script applies pending migrations (`prisma migrate deploy`, using
  `DIRECT_URL`) before production builds only, so a preview never changes the database.
- Before inviting outside users, run `npm run check:launch` (or open `/admin/launch`) to see
  which production switches are on: see [docs/beta-checklist.md](beta-checklist.md).
