# Jane: an AI financial controller that runs your money on autopilot

**The goal.** Jane looks through your bank accounts securely through Plaid and builds a
picture of who you are, such as a college student, a dog owner or a mother of three. Then it
goes through every area of your money:

- subscriptions and bills
- bank fees and idle cash
- cards, loans and debt
- insurance
- taxes
- investing and retirement
- goals and plans

In each area it finds the best plan for you. It then prefills the steps through connectors, so
all you do is tap yes or no.

**Where it is now.** Jane is in a closed, read-only beta at
[jane-dusky.vercel.app](https://jane-dusky.vercel.app). To try it without an account, upload a
bank statement on the landing page. It's analyzed as a temporary visitor and deleted within 24
hours.

## What the MVP does

- **Reads your money.** Bank accounts link through Plaid, read-only, or you can upload a CSV
  or OFX export.
- **Builds a picture of you.** Jane works out who you are from your money: income and paydays,
  household, pets, vehicles, housing, school, life events. That picture shapes every plan.
- **Finds the best plan in every area.** A detection engine and detectors for each area find
  what each part of your money is costing you and what would be better. Each suggestion shows
  a confidence percentage.
- **Gives you the steps.** Each plan comes as a short card. In the beta, a "yes" gives you the
  exact steps to take yourself. Next, connectors will prefill and carry out those steps for
  you, in stages, starting read-only.
- **Explains and answers.** A chat built on Claude answers questions using tools over your own
  data. Every sentence passes a guardrail check before you see it.
- **Shows the whole picture.** One home page covers net worth, safe-to-spend and what's coming
  up, with a page for each area. Large figures are hidden until you choose to show them.

## How it's built

| Layer     | Choice                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| App       | Next.js 16 (App Router), React 19, TypeScript in strict mode, Tailwind CSS            |
| Data      | Postgres with Prisma; money stored as integer cents, all times in UTC                 |
| Bank data | Plaid (Transactions, Liabilities), plus CSV and OFX imports parsed in memory          |
| AI        | Anthropic Claude for the chat and explanations, with a guardrail check on every reply |
| Auth      | Auth.js with email magic links and Google sign-in                                     |
| Hosting   | Vercel, with Vercel Cron for scheduled jobs                                           |
| Testing   | Vitest (unit and integration) and Playwright (end-to-end)                             |

```
Plaid / CSV / OFX ──► normalize ──► accounts and transactions (Postgres)
                                          │
                                          ▼
                        detection engine + sector detectors
                                          │
                       ┌──────────────────┴──────────────────┐
                       ▼                                     ▼
            cards with steps to take        chat: Claude + tools over the person's data
                                                    │
                                                    ▼
                                           guardrail check
```

The full map of folders, data flow and scheduled jobs is in
[docs/architecture.md](docs/architecture.md).

## Engineering highlights

- **Deterministic money math.** The model never calculates a dollar figure. All numbers come
  from tested code; Claude explains them and calls tools to look them up.
- **One person's data stays theirs.** Every user-owned table carries a `user_id`, and every
  query goes through a helper scoped to the signed-in user. An access-proof test checks every
  route: someone holding another person's IDs gets nothing back.
- **Secrets handled carefully.** Plaid access tokens are encrypted with AES-256-GCM and are
  never logged or returned. Uploaded files are parsed in memory and never stored raw.
- **Guardrails on AI output.** Before anything is shown, Claude's replies are checked for
  unsupported figures, promised outcomes, and investment, tax or legal advice. A dedicated
  test suite covers the refusals.
- **An audit trail.** Every sensitive event is written to an audit log, and every funnel
  event to an analytics table.
- **Tested heavily.** There are about 9,300 test cases across 1,360 unit and integration
  test files and 111 Playwright specs. They include differential tests, such as the same
  person and scenarios on either side of UTC midnight, to catch time-zone bugs.
- **Safe deploys.** Only commits whose CI has passed reach production. Each deploy is checked
  live, and a failed check rolls back to the last good build.

## How it was built

Jane is built by two student founders working with a team of AI coding agents (Claude Code).
The agents work in parallel, each on its own branch. The rules every change must follow are
written down in [CLAUDE.md](CLAUDE.md), and the full product spec is in
[docs/spec.md](docs/spec.md).

A change reaches users only after passing:

- **CI:** type checks, lint, unit, integration and end-to-end tests.
- **Repository gates:** checks on migrations, protected test files and an access map for
  server actions.
- **The green-commit deploy:** only commits with passing CI ship, and each is checked live.

Separate agents keep running security-audit and debugging rounds against local builds. Each
fix ships with a test that fails without it.

## Running it locally

1. Use the Node version in `.nvmrc` (`nvm use`).
2. Run `cp .env.example .env`, then fill in `DATABASE_URL`, `DIRECT_URL` and `AUTH_SECRET`.
   - Without `RESEND_API_KEY`, magic links print to the dev server console.
   - Without the Google keys, the Google button is hidden.
3. Run `npm install`, which also generates the Prisma client.
4. Run `npx prisma migrate dev` to apply the migrations.
5. Run `npx playwright install chromium` once, for the end-to-end tests.
6. Optional: to run the cross-user access test against real Postgres locally (CI always runs
   it), export `TEST_DATABASE_URL` pointing at a scratch database, then run
   `DIRECT_URL=$TEST_DATABASE_URL npx prisma migrate deploy`.

On Vercel, the `vercel-build` script applies pending migrations before production builds
only, so preview deployments never change the database.

To import your own data, sign in and go to `/import`. Add an account with its current balance,
which bank exports leave out, then upload CSV or OFX exports and confirm. The supported formats
are in `src/data-sources/csv/formats.ts`. Keep real exports in `private/`, which git ignores.

To make someone an admin:
`UPDATE users SET role = 'admin' WHERE email = 'you@example.com';`

| Command                  | What it does                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Start the app on localhost:3000                                                                                                                |
| `npm test`               | Unit and integration tests (Vitest)                                                                                                            |
| `npm run test:e2e`       | End-to-end tests (Playwright)                                                                                                                  |
| `npm run lint`           | ESLint                                                                                                                                         |
| `npm run typecheck`      | TypeScript check                                                                                                                               |
| `npm run format`         | Format with Prettier                                                                                                                           |
| `npm run checks:answers` | Check the chat's answers against a scratch database. Claude's grades are included only when `ANTHROPIC_API_KEY` is set, within a spending cap. |
