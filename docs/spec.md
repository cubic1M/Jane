# Financial Controller MVP — Spec and Claude Code Build Steps

*Oct 17, 2026 · @Someone*

## Summary

The MVP proves one thing: people will link their accounts and say yes to an agent acting on their money. It ships the cross-category scan, decision cards, and a concierge team that executes approved actions by hand, in about ten weeks with two or three people.

| In scope | Out of scope (later) |
| --- | --- |
| CSV import of the founders' own data first; Plaid (Transactions only) before outside users | Liabilities and Investments data |
| Rule-based detection across subscriptions, fees, idle cash, insurance, card interest | Investing, crypto, any trade execution |
| LLM-written explanations of each finding | Partner API integrations (rails) |
| "Money found" savings report | Robinhood or brokerage deals |
| Decision cards with yes / no and a full decision log | Real membership billing |
| Internal concierge queue; team executes by hand | Native mobile apps (responsive web only) |
| Weekly digest email | Moving money or holding funds |
| Willingness-to-pay test via Stripe | Adviser registration |

The build runs in eleven steps, with Plaid added at step 7 after the founders test on their own CSV data; the second half of this doc holds one Claude Code prompt per step.

## Status (Oct 18, 2026)

Steps 1–26 are built (24 came before 22, because do-it-yourself kits need its cancel links). Where the build differs from the original plan, the plan below has been kept and the difference is noted here.

| Step | Shipped in | Notes |
| --- | --- | --- |
| 1–3 Foundation, auth, CSV import | PRs #1–#2 | |
| 4 Detection engine | PR #3 | Plaid PFC v2 category names |
| 5 LLM explanations and guardrails | PR #5 | Explanations written after the import response; refusals fall back to templates |
| 6 Report, decision cards, decision log | PR #6 | Card is its own page; card hash proves which version was approved; e2e tests run in CI |
| 7 Plaid linking and sync | PR #7 | Detection uses Plaid streams per account and our fallback for the rest, so CSV and Plaid data mix; CSV import kept for admins and existing CSV users |
| 8 Concierge queue and metrics | PR #8 | Non-admins get a real 404 via the proxy |
| 9 Weekly digest | PR #9 | Daily cron, one digest per person per week on their Monday |
| 10 Membership test | PR #10 | Stripe optional: Reserve always works, the paid button appears once keys are set |
| 11 Beta hardening | PRs #11–#12 | Error monitoring stored in our own database instead of a third-party service; rate limits in Postgres; ADMIN_EMAILS makes the founders admins; checklist status in docs/beta-checklist.md |
| 12 Legal pages and consent | PR #14 | Policy and terms are drafts marked for counsel review (LEGAL_REVIEWED); sign-up and existing users accept the current Terms version |
| 13 Home dashboard | PR #15 | /home is where signed-in people land |
| 14 Data export and account management | PR #16 | JSON export leaves out tokens, cursors, the MFA secret, sessions and team notes |
| 15 Spending insights | PR #22 | Transfers and card payments aren't counted as spending |
| 16 Bills and cash-flow forecast | PR #23 | Low balance ahead is a finding with no dollar estimate; checking accounts only |
| 17 Alerts | PR #24 | Only events from the last 7 days alert, so a first import doesn't flood; low balance alerts at most once per account per month; "unsubscribe" in an alert email turns alert emails off but keeps them in the app |
| 18 Refunds and disputes | PR #25 | Refunds count once (not yearly) and read "Could get back"; charge-after-cancel uses the date our team finished a cancellation; trials need 3+ days between the small and full charge so fuel and hotel holds don't match; the double-charge alert and finding share one rule; the request_refund playbook starts src/config/playbooks.ts (more in step 21) |
| 19 Bill negotiation | PR #26 | Phone and internet/TV only: insurance stays with insurance_reshop, since one price range would mislead; the ranges are our own estimates from published list prices, marked for review; the guardrails reject any bill card that doesn't say "typical price"; the call script is in src/config/playbooks.ts |
| 20 Debt payoff planner | PR #27 | /debt, linked from card interest cards; runs in the browser from balances on linked cards, with APR and minimums typed by the person; strategies named "highest rate first" and "smallest balance first" (avalanche and snowball as asides); no Claude text, and all planner wording is checked by a new "recommends a choice" guardrail |
| 21 Team playbooks and drafted messages | PR #28 | Drafts are built from the privacy-safe explain input, cut to the facts each request needs, with [placeholders] for the person's name and email; no draft for moving cash, insurance quotes or due-date changes (no single company to write to); drafts aren't stored, each one is audit-logged |
| 24 Merchant directory | PR #29 | Built before 22 and 23; seeded with 21 common subscriptions in the migration (from src/config/merchant-seed.ts, all unreviewed); detection gives directory merchants one name and fills missing categories; one-word names match exactly, so "Apple Store" isn't Apple's subscriptions; no seeded prices (they change too often), the team adds them when reviewing |
| 22 Do-it-yourself kits | PR #30 | A third answer on the card ("I'll do it myself"), stored as a decision with choice diy and no action; kits for cancelling, price increases, refunds, bank fees (email via mailto) and bill negotiation (call script); "I did it" sets diy_done_at and the finding to done; approval rate counts do-it-yourself as a yes |
| 23 Ask Jane | PR #31 | Answers are held until the guardrails pass, so the stream shows what Jane is looking up and then the whole answer, never unchecked text; allowed figures are those in tool results, the question and earlier answers; tools return cleaned-up merchant names (transfers just say "Transfer"), never raw descriptions or account names; Claude uses adaptive thinking with a manual tool loop; checked against the real API only by an opt-in live test |
| 25 Household sharing | PR #32 | Two people per household; invite links work only for the invited email, once, for 7 days, and are shown to the inviter (emailed too when email is set up); partners see only undecided findings that sit entirely on shared accounts, so no decision can be read off a status; sharedReadFor in db-scoped.ts is read-only by construction and checks membership on every call |
| 26 Installable app and notifications | PR #33 | Icons are drawn by a route (no image files); the service worker caches only the offline page, never pages with data; installability is checked by tests against Chrome's criteria, since Lighthouse 12 dropped its PWA category and can't run in CI here; push needs VAPID_* keys and the person turning it on per device, then urgent alerts go to the phone instead of email (email if no device takes it), under the same daily cap |

Still needed from a person before outside users: counsel (insurance referral licensing, privacy policy and terms), Plaid Production approval and questionnaire, a backup restore test, and admins enrolling in two-factor. See docs/beta-checklist.md.

## Success metrics

Set each target before the beta opens, so results can't be reinterpreted afterwards. Every metric comes from events the app logs from step 1.

| Metric | Definition | Target |
| --- | --- | --- |
| Link rate | Signed-up users who link at least one account | Set before beta |
| Money found | Median annual savings identified per linked user, in dollars | Set before beta |
| Approval rate | Cards approved / cards shown, per finding type | Set before beta |
| Completion rate | Approved actions the team completes successfully | Set before beta |
| Willingness to pay | Users who reserve or pay for membership after their first completed action | Set before beta |
| 30-day retention | Linked users who open the app or a digest in days 23–30 | Set before beta |
| Minutes per action | Team time spent per completed action, per type | Tracked; drives what to automate first |

## Architecture

The MVP is one Next.js app with a Postgres database; every outside service is a managed API, and the only "partner rail" is your own team.

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js (App Router), TypeScript, Tailwind | One codebase for pages, API routes and admin |
| Database | Postgres with Prisma | Relational data, easy migrations |
| Auth | Auth.js, magic link and Google | No passwords to store |
| Bank data | Plaid, Transactions only | Read-only, cheapest product set |
| LLM | Anthropic API | Finding explanations and edge-case classification |
| Payments | Stripe Checkout | Willingness-to-pay test without building billing |
| Email | Resend | Magic links, status updates, digests |
| Analytics | PostHog | Funnel and success metrics |
| Hosting and jobs | Vercel and Vercel Cron | Deploys and scheduled sync, digest, cleanup |

## Data model

Twelve tables in Postgres. Money is stored as integer cents, timestamps in UTC, and every user-owned row cascades on account deletion.

| Table | Purpose | Key fields |
| --- | --- | --- |
| users | One row per person | id, email, name, created_at, deleted_at |
| plaid_items | One per bank login | id, user_id, plaid_item_id, access_token_encrypted, institution_name, status, transactions_cursor, last_synced_at |
| accounts | Accounts inside an item | id, item_id, plaid_account_id, name, mask, type, subtype, current_balance_cents, available_balance_cents |
| transactions | Synced transactions | id, account_id, plaid_transaction_id, date, amount_cents, merchant_name, pfc_primary, pfc_detailed, pending |
| recurring_streams | Recurring charges from Plaid | id, account_id, plaid_stream_id, merchant_name, frequency, last_amount_cents, average_amount_cents, last_date, status |
| findings | One detected opportunity | id, user_id, type, title, explanation, annual_savings_cents, confidence, evidence (json), status, created_at |
| decisions | A user's yes or no on a card | id, finding_id, user_id, choice, card_snapshot (json), created_at |
| actions | Concierge work from a yes | id, decision_id, type, status, assignee, notes, minutes_spent, started_at, completed_at |
| digests | Weekly emails sent | id, user_id, week_start, payload (json), sent_at, opened_at |
| membership_intents | Willingness-to-pay test | id, user_id, kind (reserve or paid), stripe_session_id, amount_cents, created_at |
| audit_log | Every sensitive event | id, actor_id, actor_type (user, admin, system), event, target_type, target_id, metadata (json), created_at |
| analytics_events | Funnel events | id, user_id, name, properties (json), created_at |

Finding types: `subscription_review`, `duplicate_subscription`, `price_increase`, `bank_fees`, `idle_cash`, `insurance_reshop`, `card_interest`.

Finding status: `new`, `shown`, `approved`, `declined`, `in_progress`, `done`, `failed`.

Action status: `queued`, `in_progress`, `waiting_on_user`, `done`, `failed`.

## Detection rules

Rules come first and decide what counts as a finding; the LLM only explains and classifies edge cases. Every threshold lives in one config file so it can be tuned during the beta. Savings estimates are conservative and labelled as estimates on the card.

| Finding | Trigger | Annual savings estimate |
| --- | --- | --- |
| Subscription review | Active recurring outflow stream with a subscription-like merchant or category | 12 × monthly amount, counted only if the user approves a cancel |
| Duplicate subscription | Two or more active streams in the same service category (e.g. two music services) | Annual cost of the cheaper one |
| Price increase | Latest charge on a stream is ≥ 5% above its previous average | 12 × the increase per month |
| Bank fees | Transactions in Plaid's bank-fee categories (overdraft, ATM, maintenance) in the last 12 months | Sum of fees in the last 12 months |
| Idle cash | Depository balance above 3 × average monthly spending | Excess balance × (reference high-yield rate − assumed current rate); both rates in config |
| Insurance reshop | Recurring payment in Plaid's insurance category | Not estimated in dollars until a partner quote exists; card shows "could be lower, get quotes" |
| Card interest | Interest-charge transactions on credit accounts in the last 12 months | Sum of interest in the last 12 months |

Rules for the engine:

- Category names must be checked against Plaid's current personal finance category taxonomy before coding; the names above are descriptive, not exact
- A finding is created once and updated in place on later scans, never duplicated
- Each finding stores its evidence (transaction ids, amounts, dates) so the card can show why
- The "money found" total sums only findings with a dollar estimate and confidence ≥ medium
- Rates, thresholds and multipliers are configuration, never hard-coded in the rule logic

## Screens and user flow

A new user goes from landing page to their savings number in under five minutes; everything after that is cards and status.

1. Landing page: one promise ("See how much money you're losing"), waitlist or sign-up
2. Sign up: email magic link or Google
3. Connect accounts: short trust explainer (read-only, revoke anytime), then Plaid Link; add more accounts afterwards (the founders' first round uses CSV upload instead)
4. Scanning: progress state while transactions sync and rules run
5. Savings report: headline "money found per year", findings sorted by dollars, each opening a card
6. Decision card: what changes, savings per year, what you give up, alternatives, referral disclosure if any, yes / no
7. Action status: each approved action with its live status (queued, in progress, waiting on you, done)
8. Membership offer: shown after the first completed action; reserve or pay
9. Settings: connected accounts, disconnect, delete all my data, email preferences

Internal screens, admin only:

- Concierge queue: approved actions to work, filtered by type and status
- Action detail: the user's card snapshot, evidence, notes, status buttons, minutes-spent field
- Metrics: the success metrics table, live

## Concierge back office

Every yes becomes an action in the queue, and a team member finishes it by hand within one business day. The user sees status updates as if the agent did it; the team logs minutes spent so the most time-consuming, most-approved actions get automated first.

| Action type | What the team does | User involvement |
| --- | --- | --- |
| Cancel subscription | Cancels via the merchant's site or support using the user's guidance; or sends the user a one-click cancel link plus steps | May need the user to log in or forward a confirmation |
| Fight a price increase | Contacts the merchant to request the old rate or a retention offer | None, unless the merchant requires the account holder |
| Recover bank fees | Drafts and sends a fee-reversal request, or gives the user a script | User may need to call or send it |
| Move idle cash | Sends a guided link to a partner high-yield account and the transfer steps | User opens the account and moves money themselves |
| Insurance reshop | Sends a referral link to a licensed marketplace, with the user's current policy details prefilled where allowed | User completes quotes and the switch |
| Card interest | Sends a payoff-order plan or a balance-transfer option | User acts |

Queue rules:

- Nothing is ever done without a logged yes; the card snapshot is attached to the action
- The team never stores the user's passwords for other services; if a login is needed, the user does that step
- Status changes notify the user by email; "waiting on you" includes exactly what they need to do
- Failed actions record the reason, so the card copy and rules can be fixed

## Security and compliance checklist

The MVP avoids adviser registration by giving no investment advice and moving no money; these items must all be ticked before the first outside beta user links an account. Confirm the legal items with counsel.

- [ ] Plaid access tokens encrypted at rest (AES-256-GCM, key from a secrets manager, never in the repo)
- [ ] Read-only Plaid products only; Transactions alone in the MVP
- [ ] Plaid webhooks verified before processing
- [ ] Admin screens behind role check and MFA; every admin view of user data written to the audit log
- [ ] "Delete all my data" removes every Plaid Item (`/item/remove`) and all rows for the user
- [ ] Inactive Items removed on a schedule to stop Plaid billing
- [ ] No investment, tax or legal advice in any card or LLM output; a guardrail check on LLM text before display
- [ ] Referral relationships disclosed on any card that uses one
- [ ] Counsel has confirmed whether insurance referral fees need a license in your launch state
- [ ] Privacy policy and terms published, covering Plaid data use, retention and deletion
- [ ] Plaid's security questionnaire answered truthfully for Production access
- [ ] Rate limiting on auth and API routes; dependency and secret scanning in CI
- [ ] Backups enabled and a restore tested once

## Non-code setup tasks

Start these in week 1; several have lead times longer than the code they unblock.

| Task | Why | When |
| --- | --- | --- |
| Incorporate and open a business bank account | Required for Plaid, Stripe and partner agreements | Week 1 |
| Plaid: sign up for the free Trial (10 Items) | Optional shortcut: your own accounts without CSV exports; free up to 10 Items | Week 1 |
| Plaid: apply for Production access, pay-as-you-go | Security review takes time; needed before outside users | Week 1 |
| Stripe account | Willingness-to-pay test in step 9 | Week 2 |
| Anthropic API key | LLM explanations in step 5 | Week 2 |
| Domain, email sending domain with SPF, DKIM, DMARC | Magic links and digests must land in inboxes | Week 1 |
| Hosting and managed Postgres accounts | Deploy from step 1 | Week 1 |
| Analytics account (e.g. PostHog) | Funnel events from step 1 | Week 1 |
| Counsel: insurance referral question, privacy policy, terms | Compliance checklist items | Weeks 1–3 |
| Referral partners: one insurance marketplace, one high-yield account | Concierge actions need somewhere to send users | Weeks 2–6 |
| Beta list: 20 friendly users, then 50–200 | Step 10 and the beta | Weeks 4–7 |

## Using Claude Code

Put the CLAUDE.md below in the repo root first; Claude Code reads it at the start of every session, so each step's prompt can stay short. Then run the build steps in order, one session per step.

Workflow for every step:

1. Start a fresh Claude Code session in the repo and paste the step's prompt
2. Ask it to plan first ("Make a plan before writing code"), review the plan, then let it build
3. When it says it's done, run the tests and click through the acceptance criteria yourself
4. Review the diff, commit, and push; deploy to staging
5. Only then start the next step

CLAUDE.md:

```markdown
# Financial Controller MVP

## What this is
A web app that links a user's bank accounts through Plaid, finds money they are
losing (subscriptions, fees, idle cash, insurance, card interest), and shows each
finding as a decision card. When the user approves, an action is queued for our
concierge team, who complete it by hand. No money movement, no investing, no
investment advice in this MVP.

## Stack
- Next.js (App Router) + TypeScript, strict mode
- Tailwind CSS for styling
- Postgres with Prisma ORM; money as integer cents, timestamps UTC
- Auth.js: email magic link and Google sign-in
- CSV import of the founders' own data first; Plaid Node SDK (Transactions
  only) added in step 7 behind the same DataSource interface
- Anthropic SDK for finding explanations; model name from env ANTHROPIC_MODEL
- Stripe Checkout for the membership test
- Resend for email
- PostHog for analytics events
- Vercel hosting and Vercel Cron for scheduled jobs
- Vitest for unit tests, Playwright for end-to-end tests

## Rules
- Never log or return Plaid access tokens; store them encrypted (AES-256-GCM)
  with the key from env TOKEN_ENCRYPTION_KEY
- Uploaded CSV files are parsed in memory and never stored raw
- All secrets come from env vars; keep .env.example up to date, never commit .env
- Every user-owned table has user_id and is queried through a helper that
  scopes by the signed-in user
- Every sensitive event writes to audit_log; every funnel event to analytics_events
- Detection thresholds and rates live in src/config/detection.ts, never inline
- LLM output never gives investment, tax or legal advice; run it through the
  guardrail check in src/lib/guardrails.ts before display
- Write tests for every rule and every API route you add
- Prefer small, readable modules over clever abstractions
- When unsure about a Plaid field or category name, check the Plaid docs instead
  of guessing

## Commands
- npm run dev / npm test / npm run test:e2e / npm run lint / npx prisma migrate dev
```

## Build steps 1–3: foundation and your own data

Steps 1–3 end with the founders' own bank and card transactions, exported as CSV files, flowing into the database. Plaid waits until step 7.

### Step 1: Scaffold the project (week 1)

> Read CLAUDE.md. Set up the project skeleton for the Financial Controller MVP.
>
> Build:
> 1. A Next.js App Router project in TypeScript (strict), with Tailwind, ESLint
>    and Prettier.
> 2. Prisma connected to Postgres via DATABASE_URL, with an empty initial migration.
> 3. Vitest for unit tests and Playwright for end-to-end tests, each with one
>    passing example test.
> 4. A GitHub Actions workflow that runs lint, unit tests and a secret scan on
>    every push.
> 5. .env.example listing every env var named in CLAUDE.md, with comments.
> 6. src/lib/analytics.ts: a track(userId, name, properties) helper that writes to
>    PostHog and to the analytics_events table (create the table now).
> 7. A landing page at / with one headline ("See how much money you're losing"),
>    a short three-point explainer (read-only access, you approve everything,
>    delete anytime) and a Get started button to /signup. Track landing_viewed
>    and get_started_clicked.
> 8. A /api/health route returning { ok: true }.
>
> Acceptance criteria:
> - npm run dev shows the landing page; npm test and npm run test:e2e pass
> - CI passes on a fresh push
> - No secrets in the repo
>
> Do not build auth, Plaid, or any other feature yet.

### Step 2: Auth, schema and core helpers (week 1–2)

> Read CLAUDE.md. Add authentication, the full database schema, and core helpers.
>
> Build:
> 1. Prisma models for every table in the spec's data model: users, plaid_items,
>    accounts, transactions, recurring_streams, findings, decisions, actions,
>    digests, membership_intents, audit_log, analytics_events. Money as integer
>    cents. Enums for finding type, finding status, action status and decision
>    choice. Cascading deletes from users. Indexes on every user_id and on
>    plaid_transaction_id (unique).
> 2. Auth.js with email magic link (sent through Resend) and Google sign-in.
>    Pages: /signup, /login. Signed-in users land on /import until Plaid arrives in step 7, then on /connect.
> 3. A role field on users (user | admin) and a requireAdmin() server helper.
> 4. src/lib/db-scoped.ts: helpers that always filter by the signed-in user's id.
>    Add a test that one user cannot read another user's rows.
> 5. src/lib/crypto.ts: encrypt/decrypt with AES-256-GCM using
>    TOKEN_ENCRYPTION_KEY. Tests: round trip, tampered ciphertext fails.
> 6. src/lib/audit.ts: logAudit(actor, event, target, metadata).
>    Log sign-up and sign-in.
> 7. Track signup_completed.
>
> Acceptance criteria:
> - I can sign up with a magic link and with Google, sign out, and sign back in
> - Migrations run cleanly on an empty database
> - All tests pass, including the cross-user access test

### Step 3: Import your own data from CSV (week 2)

> Read CLAUDE.md. Let the two founders import their own bank and credit card
> transactions from CSV exports. Plaid comes later (step 7), so build this
> behind a data-source interface that Plaid can plug into without rewrites.
>
> Build:
> 1. src/data-sources/types.ts: a DataSource interface that produces normalized
>    accounts and transactions (date, amount_cents with outflows positive,
>    description, merchant_name, category_primary, category_detailed, account).
>    Add a source field (csv | plaid) to accounts and transactions; make the
>    Plaid-specific columns nullable.
> 2. src/data-sources/csv/: parsers for the export formats of our banks and
>    cards: [list your banks and card issuers here, and attach one sample export
>    from each with real numbers replaced]. Detect the format from the header
>    row; reject unknown formats with a clear message.
> 3. Normalize merchants (strip store numbers, payment-processor prefixes,
>    dates) and dedupe overlapping uploads by account, date, amount and
>    normalized description.
> 4. Categorize every transaction using Plaid's personal finance category
>    taxonomy as our category list, so Plaid data needs no mapping later:
>    keyword rules first, then the LLM for anything unmatched, cached per
>    normalized merchant. Store the category and whether a rule or the LLM set it.
> 5. /import page: pick or create an account (name, type: checking, savings or
>    credit card, current balance entered by hand), upload one or more CSVs,
>    preview parsed rows and any skipped rows with reasons, then confirm.
> 6. Parse files in memory; never store the raw file. Audit-log
>    import_completed with row counts.
> 7. /scanning page that shows progress and moves to /report when processing
>    finishes (detection arrives in step 4; for now just finish).
> 8. Track import_started, import_completed, import_failed.
>
> Acceptance criteria:
> - Importing the same file twice creates no duplicates
> - Unit tests for each bank format, using sanitized fixture files
> - An unknown CSV format fails with a readable error, not a crash
> - Hand-entered balances show on each account (CSV exports usually lack them)

## Build steps 4–6: findings and decisions

Steps 4–6 end with the core product loop working: a user sees their money-found number, opens a card, and says yes or no.

### Step 4: Detection engine (weeks 3–4)

> Read CLAUDE.md and the Detection rules section of the spec (pasted below).
> Build the rule-based detection engine.
>
> [Paste the Detection rules table and bullet list here.]
>
> Build:
> 1. src/config/detection.ts with every threshold and rate as named constants:
>    price-increase threshold (5%), idle-cash multiple (3 months of spending),
>    reference high-yield rate, assumed current rate, lookback window (12 months),
>    minimum confidence for the money-found total.
> 2. src/detection/rules/: one module per finding type (subscription_review,
>    duplicate_subscription, price_increase, bank_fees, idle_cash,
>    insurance_reshop, card_interest). Each takes the user's accounts,
>    transactions and recurring streams and returns candidate findings with
>    title, annual_savings_cents (or null), confidence (low | medium | high)
>    and evidence (transaction ids, amounts, dates).
> 3. Look up the exact Plaid personal finance category names for bank fees,
>    interest charges and insurance in Plaid's docs; put them in the config file.
> 4. Fallback recurring detection when recurring_streams is empty: group outflows
>    by normalized merchant, 3+ charges at a regular interval with amounts
>    within 10%.
> 5. runDetection(userId): runs all rules and upserts findings keyed by
>    (user_id, type, stable key such as merchant or account), updating existing
>    findings instead of duplicating them. Never resurrect a finding the user
>    declined unless its amount changed by more than 20%.
> 6. moneyFound(userId): sums annual_savings_cents for open findings at or above
>    the configured confidence.
> 7. Call runDetection after every CSV import (and every Plaid sync from step 7); mark first detection complete so
>    /scanning can move on.
> 8. Track detection_completed with counts per type and the money-found total.
>
> Acceptance criteria:
> - Unit tests with fixture data for every rule, including no-finding cases
> - Running detection twice produces identical findings
> - No threshold or rate appears outside the config file

### Step 5: LLM explanations and guardrails (week 4)

> Read CLAUDE.md. Add plain-language explanations to each finding using the
> Anthropic SDK, with strict guardrails.
>
> Build:
> 1. src/lib/explain.ts: for a finding, send only what is needed (finding type,
>    merchant names, amounts, dates, the savings estimate). Never send account
>    numbers, names, emails or access tokens.
> 2. Ask for JSON only: { title, explanation (max 2 sentences), give_up (what
>    the user gives up, 1 sentence), alternatives (up to 3 short strings) }.
>    Parse safely; on any failure, fall back to template text per finding type.
> 3. src/lib/guardrails.ts: reject output that (a) recommends specific
>    securities, investments or crypto, (b) gives tax or legal advice,
>    (c) contains a dollar figure that does not match the finding's evidence or
>    estimate, or (d) promises a guaranteed outcome. Rejected output falls back
>    to the template.
> 4. Use the LLM for one classification task too: deciding whether an ambiguous
>    recurring merchant is a subscription. Rules still decide the finding.
> 5. Cache explanations on the finding; regenerate only when its evidence changes.
> 6. Store the model name and prompt version on each explanation for the audit
>    trail.
>
> Acceptance criteria:
> - Tests for each guardrail rule, including a mismatched dollar figure
> - With the API key unset, every finding still shows template text
> - No personal identifiers in any request payload (add a test that inspects it)

### Step 6: Savings report, decision cards and decision log (weeks 4–5)

> Read CLAUDE.md and the Screens and user flow section of the spec. Build the
> savings report and decision cards.
>
> Build:
> 1. /report: headline "We found $X a year" from moneyFound(), then open findings
>    sorted by annual savings (findings without a dollar estimate last). Each
>    row opens a card. Mobile-first layout.
> 2. Decision card (modal or page): what changes, savings per year (marked as an
>    estimate), what you give up, alternatives, the evidence (recent charges with
>    dates), and a referral disclosure line when the action uses a referral
>    partner. Yes and No buttons.
> 3. POST /api/decisions: records the choice with a full JSON snapshot of the
>    card as shown. Yes sets the finding to approved and creates an action with
>    status queued. No sets it to declined, with a 10-second undo.
>    Audit-log both.
> 4. /actions: the user's approved actions with live status and, for
>    waiting_on_user, exactly what they need to do.
> 5. Empty states: no findings yet, and "nothing found" (still show what we
>    checked).
> 6. Track report_viewed, card_opened, decision_yes, decision_no, decision_undone.
>
> Acceptance criteria:
> - End-to-end test: import a fixture CSV -> report -> approve a card -> action
>   appears on /actions with status queued
> - Each decision row holds the exact card text the user saw
> - Works on a 375px-wide screen

## Build steps 7–11: Plaid, operations, retention, revenue, launch

Steps 7–11 end with a beta-ready product: outside users link accounts through Plaid, the team can work the queue, users get a weekly digest and a membership offer, and the security checklist is complete.

### Step 7: Plaid linking and sync, before outside users (weeks 6–7)

> Read CLAUDE.md. Add Plaid as a second data source so beta users can link
> accounts instead of uploading CSVs. Implement the DataSource interface from
> step 3. Use the Plaid Node SDK, Sandbox by default, environment from
> PLAID_ENV. Request the Transactions product only.
>
> Build:
> 1. POST /api/plaid/link-token: creates a link token for the signed-in user with
>    a webhook URL pointing at /api/plaid/webhook.
> 2. POST /api/plaid/exchange: exchanges the public token, stores the item with
>    the access token encrypted, fetches accounts (source plaid), then starts the
>    first sync. Audit-log item_linked.
> 3. A sync function using /transactions/sync with the stored cursor: upsert
>    added and modified transactions, delete removed ones, save the new cursor.
>    Store Plaid's personal finance category (primary and detailed) directly.
> 4. Recurring streams: call /transactions/recurring/get after each sync and
>    upsert recurring_streams. If the endpoint is not enabled for our Plaid
>    account, log a clear warning and skip it; detection falls back.
> 5. POST /api/plaid/webhook: verify the webhook signature per Plaid's docs
>    before doing anything. Handle SYNC_UPDATES_AVAILABLE by running a sync.
>    Handle item errors (e.g. ITEM_LOGIN_REQUIRED) by marking the item status
>    and showing a reconnect prompt using Link update mode.
> 6. /connect page: trust explainer, Plaid Link button, list of linked
>    institutions, "add another account", Continue to the existing /scanning.
>    Keep /import available for founders and admins only.
> 7. Run detection after every sync, exactly as after a CSV import.
> 8. A daily Vercel Cron job that syncs items not updated in 24 hours.
> 9. Track link_started, link_succeeded, link_failed, first_sync_completed.
>
> Acceptance criteria:
> - In Sandbox I can link a test institution and see findings on /report
> - Re-running sync never creates duplicates
> - A forged webhook is rejected
> - Access tokens never appear in logs, API responses or the client bundle
> - Tests cover sync upserts and removals with mocked Plaid responses
> - CSV-imported data for founders keeps working alongside Plaid data

### Step 8: Concierge queue and metrics (weeks 5–6)

> Read CLAUDE.md and the Concierge back office section of the spec (pasted below).
> Build the internal admin tools.
>
> [Paste the Concierge back office table and queue rules here.]
>
> Build:
> 1. /admin, protected by requireAdmin(); every page view of user data writes to
>    audit_log.
> 2. /admin/queue: actions filtered by type and status, oldest first; highlight
>    any queued longer than one business day.
> 3. /admin/actions/[id]: the card snapshot the user approved, the finding's
>    evidence, notes, assignee, status buttons (in_progress, waiting_on_user,
>    done, failed), a required minutes_spent field when closing, and a required
>    reason when failing. For waiting_on_user, a required "what the user needs to
>    do" text shown on their /actions page.
> 4. Status changes update the finding status and email the user via Resend.
> 5. /admin/metrics: every metric in the spec's Success metrics table, computed
>    from analytics_events and the DB, for the last 7 and 30 days, plus minutes
>    per action by type.
> 6. Track action_started, action_waiting, action_done, action_failed.
>
> Acceptance criteria:
> - A non-admin gets a 404 on every /admin route
> - Closing an action without minutes, or failing without a reason, is blocked
> - The user sees each status change on /actions and by email

### Step 9: Weekly digest (week 6)

> Read CLAUDE.md. Build the weekly digest email.
>
> Build:
> 1. A weekly Vercel Cron job (Monday morning, user's timezone if stored, else
>    US Pacific) that builds a digest per active user: saved this week and to
>    date (from done actions), pending actions and what they need from the user,
>    new findings since the last digest, and the money-found total.
> 2. Skip users with nothing new and nothing pending; never send an empty digest.
> 3. Send with Resend using a simple, readable HTML template plus a plain-text
>    version. Links go to the app with UTM parameters.
> 4. Store each digest in digests with its payload; record opens via link clicks
>    (no tracking pixel).
> 5. One-click unsubscribe and an email preferences toggle in /settings.
> 6. Track digest_sent, digest_clicked.
>
> Acceptance criteria:
> - A dry-run mode that renders digests for all users without sending
> - Tests for the skip rule and the totals
> - Unsubscribe works without signing in

### Step 10: Membership willingness-to-pay test (week 6)

> Read CLAUDE.md. Add the membership offer to test willingness to pay. No
> recurring billing yet.
>
> Build:
> 1. After a user's first action reaches done, show a membership offer on
>    /actions and in the next email: "We'll keep doing this for you, ongoing."
>    Include their saved-to-date amount.
> 2. Two buttons: Reserve (free, records intent) and Become a founding member
>    (Stripe Checkout, one-time payment, price from env MEMBERSHIP_TEST_PRICE).
> 3. POST /api/stripe/webhook: verify the Stripe signature; on
>    checkout.session.completed, record a membership_intent of kind paid.
> 4. Show the offer once per user per 14 days; never block any feature behind it.
> 5. Track membership_offer_shown, membership_reserved, membership_checkout_started,
>    membership_paid.
>
> Acceptance criteria:
> - Stripe test-mode payment creates a paid membership_intent
> - A forged Stripe webhook is rejected
> - Users who dismiss the offer don't see it again for 14 days

### Step 11: Beta hardening (weeks 7–8)

> Read CLAUDE.md and the Security and compliance checklist in the spec (pasted
> below). Make the app safe for outside beta users.
>
> [Paste the Security and compliance checklist here.]
>
> Build:
> 1. /settings: list connected institutions with Disconnect (calls /item/remove,
>    deletes that item's data) and Delete all my data (removes every Plaid item,
>    then all user rows; confirm by typing DELETE). Audit-log both.
> 2. A daily cron that removes Plaid items for users inactive 60+ days (value in
>    config) after emailing them 7 days ahead.
> 3. Rate limiting on auth, Plaid and decision routes; security headers (CSP,
>    HSTS); error monitoring with PII scrubbing.
> 4. MFA required for admin accounts.
> 5. Invite codes: sign-up requires a valid code so the beta stays closed.
> 6. A Production switch checklist script that verifies env vars, PLAID_ENV,
>    webhook URLs and Stripe live keys before deploy.
> 7. Go through every checklist item and report which are done in code and which
>    need a human (legal, Plaid questionnaire, backups restore test).
>
> Acceptance criteria:
> - After Delete all my data, no rows for that user remain and Plaid items are
>   removed (verify in Sandbox)
> - Rate limits return 429 under a simple load test
> - A written report of the checklist status

## Open questions

- [ ] Target values for each success metric
- [x] Membership test price, and whether to offer the paid option or reserve only: $49 one-time (MEMBERSHIP_TEST_PRICE); Reserve only until Stripe keys are added
- [ ] Which insurance marketplace and high-yield account to use as referral partners
- [x] Is Plaid's recurring transactions endpoint enabled on our plan, or do we rely on the fallback detector? It works in Sandbox; the fallback covers any account without streams, so either way is fine
- [ ] Launch state, for the insurance referral licensing question
- [ ] Who on the team owns the concierge queue and its one-business-day turnaround?

# Beyond the MVP: building the full financial controller

The MVP proves people will link accounts and say yes. The full Jane is a financial controller: it watches everything, explains it plainly, finds every leak, and handles the fixes, first with the concierge team, then with automation. These steps continue the numbering and keep the same rules and workflow as steps 1–11.

Principles that still hold:

- **Read-only until counsel says otherwise.** No money movement, investing, investment advice, or tax and legal advice. Phase F lists what needs licenses and isn't built until counsel signs off.
- **Rules decide, the LLM explains.** Every new finding type is a tested rule with thresholds in config; Claude only writes text and classifies edge cases, behind the guardrails.
- **Every step is shippable alone.** One PR per step, tests for every rule and route, and nothing that blocks on an outside account: when a step needs one, build a working stand-in and note what to swap in later.
- **Measure, then automate.** Minutes per action decide which concierge work to automate first.

## Phase A: beta-ready polish (steps 12–14)

### Step 12: Legal pages and consent

> Read CLAUDE.md and docs/beta-checklist.md. Add the legal pages and record consent.
>
> Build:
> 1. /privacy, /terms and /security pages written from the facts in
>    docs/beta-checklist.md (data read, what's shared with Claude, retention,
>    deletion, no tracking pixels). Show a "Draft, pending legal review" banner
>    unless env LEGAL_REVIEWED is "true".
> 2. Footer links to all three on every page.
> 3. Sign-up requires ticking "I agree to the Terms and Privacy Policy"; store the
>    accepted terms version and time on the user and audit-log it.
> 4. When the terms version changes, existing users accept the new version once
>    before continuing.
>
> Acceptance criteria:
> - Sign-up is refused without consent; the accepted version is stored
> - A terms version bump asks existing users once, then never again
> - Pages render at 375px and pass the existing CSP

### Step 13: Home dashboard

> Read CLAUDE.md. Give linked users a home page that answers "how am I doing?"
>
> Build:
> 1. /home: money found, saved to date, actions waiting on you, newest findings,
>    the next few upcoming charges, and when data was last updated.
> 2. Sign-in lands on /home once a person has any account; /connect otherwise.
> 3. Empty and loading states that never show a blank page.
>
> Acceptance criteria:
> - New users land on /connect, linked users on /home (e2e)
> - Every number on /home matches the report and actions pages
> - Works at 375px

### Step 14: Your data: freshness and export

> Read CLAUDE.md. Let people see how fresh their data is and take it with them.
>
> Build:
> 1. On /settings, each account with its balance, last update and source.
> 2. "Refresh now" for linked banks (runs a sync), rate limited.
> 3. "Download my data": a JSON file with every row the app holds for the person
>    (accounts, transactions, findings, decisions, actions, digests, settings),
>    never another person's, never tokens. Audit-log each export.
>
> Acceptance criteria:
> - The export contains every user-owned table and nothing from other users
> - Access tokens and secrets never appear in the export (test)
> - Refresh is rate limited

## Phase B: see everything (steps 15–17)

### Step 15: Spending insights

> Read CLAUDE.md. Show where money goes, without budgets or advice.
>
> Build:
> 1. src/insights: pure functions for spending by category per month, top
>    merchants, income versus spending, and month-over-month changes. Transfers,
>    card payments and refunds are handled so nothing is counted twice.
> 2. /insights with simple accessible charts (inline SVG, text alternatives) and
>    a 12-month range.
> 3. Track insights_viewed.
>
> Acceptance criteria:
> - Totals reconcile exactly with the transactions they come from (tests)
> - Card payments and transfers between the person's own accounts aren't spending
> - Charts have text equivalents and work at 375px

### Step 16: Upcoming bills and cash-flow forecast

> Read CLAUDE.md. Predict what's coming out of the person's accounts.
>
> Build:
> 1. Next expected date and amount for every active recurring stream (Plaid's
>    predicted date when present, our cadence otherwise).
> 2. A 30-day forecast for each checking account: today's balance, minus
>    upcoming bills, plus expected recurring income.
> 3. A new finding type, low_balance_risk (no dollar estimate), when the
>    forecast dips below a configured cushion before the next income.
> 4. /bills: a calendar-style list of the next 30 days.
>
> Acceptance criteria:
> - Forecast tests with fixed fixtures, including irregular income
> - low_balance_risk is created and cleared by rescans like other findings
> - Thresholds live in config

### Step 17: Alerts

> Read CLAUDE.md. Tell people when something needs their attention.
>
> Build:
> 1. An alerts table and engine run after every sync or import: new
>    subscription, price increase, fee charged, unusually large charge, possible
>    duplicate charge, low balance ahead.
> 2. /alerts in the app; urgent alerts by email right away (at most a configured
>    number per day), the rest in the weekly digest.
> 3. Per-type preferences on /settings.
> 4. Each alert is raised once per event, never repeated by a rescan.
>
> Acceptance criteria:
> - A test per alert rule, including the no-alert case
> - Preferences are respected; the daily email cap holds
> - Rescans never duplicate an alert

## Phase C: more ways to save (steps 18–20)

### Step 18: Refunds and disputes

> Read CLAUDE.md. Find money people are owed back.
>
> Build:
> 1. New finding types: duplicate_charge (same merchant and amount within a
>    configured number of days), charge_after_cancel (a charge from a merchant
>    whose cancellation action is done), trial_conversion (a first full charge
>    after a $0 or $1 charge).
> 2. A new action type, request_refund, with team playbook text.
> 3. Thresholds in src/config/detection.ts.
>
> Acceptance criteria:
> - Rule tests with fixtures, including look-alikes that must not match
> - Money found counts refunds only at medium confidence or above

### Step 19: Bill negotiation

> Read CLAUDE.md. Spot bills that are usually negotiable and priced high.
>
> Build:
> 1. A bill_negotiation finding for phone, internet, TV and insurance bills
>    above benchmark ranges in config (labelled as estimates, with the source of
>    each range noted in config).
> 2. A negotiate_bill action type for the concierge, with a script.
>
> Acceptance criteria:
> - Rule tests at, below and above each benchmark
> - Cards say "typical price" and never promise a result (guardrails)

### Step 20: Debt payoff planner (education, not advice)

> Read CLAUDE.md. Help people see what card interest costs over time.
>
> Build:
> 1. A calculator for credit cards: balances from the person's accounts, APR
>    and minimum payment entered by them. Show avalanche and snowball schedules
>    side by side with total interest and payoff dates.
> 2. Plain disclaimer: math, not a recommendation; guardrails on any LLM text.
> 3. Link from card_interest findings.
>
> Acceptance criteria:
> - Schedule math matches hand-checked examples to the cent
> - No wording that recommends a choice (guardrail tests)

## Phase D: Jane does more for you (steps 21–24)

### Step 21: Team playbooks and drafted messages

> Read CLAUDE.md. Make each concierge action faster.
>
> Build:
> 1. A playbook per action type on the admin action page: steps, what to ask the
>    person for, and how to close.
> 2. A Claude-drafted merchant email or call script for the action (guardrailed,
>    only the details the merchant needs), with a copy button.
> 3. "Automate next" on /admin/metrics: action types ranked by approvals ×
>    minutes per action.
>
> Acceptance criteria:
> - Drafts never include data the merchant doesn't need (payload test)
> - The ranking matches hand-computed fixtures

### Step 22: Do-it-yourself kits

> Read CLAUDE.md. Let people fix things themselves when that's quicker.
>
> Build:
> 1. On decision cards for supported actions, a "Do it myself" option: the
>    merchant's cancel or support link, steps, and a pre-written email (mailto).
> 2. The person marks it done; it counts as saved like a team action.
> 3. Track diy_started and diy_done.
>
> Acceptance criteria:
> - "Do it myself" never creates a concierge action
> - Savings from DIY count once in saved-to-date

### Step 23: Ask Jane

> Read CLAUDE.md. Let people ask questions about their own money.
>
> Build:
> 1. /ask: a chat with Claude using read-only, user-scoped tools (search
>    transactions, spending by category, list findings and actions, upcoming
>    bills). Streaming answers.
> 2. Every answer goes through the guardrails; no advice, no invented numbers
>    (figures must come from tool results).
> 3. Conversations stored per user, deletable, included in data export and
>    "Delete all my data". Rate limited.
>
> Acceptance criteria:
> - Tools can only read the signed-in person's data (tests)
> - A figure not in any tool result is caught by the guardrails
> - Conversations are removed by "Delete all my data"

### Step 24: Merchant directory

> Read CLAUDE.md. Build shared knowledge about merchants.
>
> Build:
> 1. A merchants table (not user data): canonical name, aliases, cancel URL,
>    support contact, category, typical prices. Admin-editable at /admin/merchants.
> 2. Used by DIY kits, playbooks, detection (better merchant matching) and cards.
> 3. Seed it with the most common subscriptions.
>
> Acceptance criteria:
> - No personal data in the merchants table (schema review and test)
> - Merchant matching improves on the existing fixtures without regressions

## Phase E: grow (steps 25–27)

### Step 25: Household sharing

> Read CLAUDE.md. Let partners see shared money.
>
> Build:
> 1. Invite a partner to a household; each person chooses which accounts to share.
> 2. Partners see shared accounts' findings; decisions stay per person.
> 3. Scoping helper extended so shared rows are readable, never writable, by the partner.
>
> Acceptance criteria:
> - A partner can't see unshared accounts or the other person's decisions (tests)
> - Leaving a household removes access immediately

### Step 26: Installable app and notifications

> Read CLAUDE.md. Make Jane feel like an app on phones.
>
> Build:
> 1. A web app manifest, icons and an offline page (PWA).
> 2. Web push for urgent alerts when VAPID keys are set; email otherwise.
>
> Acceptance criteria:
> - Lighthouse PWA checks pass
> - Push is optional and off without keys

### Step 27: Partner referrals

> Read CLAUDE.md. Turn referral partners on safely.
>
> Build:
> 1. Partner records with disclosure text, referral links and states where each
>    is allowed; cards show the disclosure word for word.
> 2. Conversion tracking (webhook or manual entry) and referral revenue in metrics.
> 3. Insurance referrals stay off until counsel's answer is recorded in config.
>
> Acceptance criteria:
> - No card with a partner action renders without its disclosure (test)
> - A partner can be turned off instantly

## Phase F: regulated capabilities (plan only)

Each of these needs licensing, a regulated partner, or legal review. Don't build until counsel signs off; when they do, each becomes its own phase of steps.

| Capability | Why it matters | Prerequisite |
| --- | --- | --- |
| Moving idle cash or paying bills | Jane acts directly instead of guiding | A licensed money-movement partner, Plaid Transfer or similar, and a legal review |
| Investing and portfolio help | The other half of a financial controller | Investment adviser registration (RIA) or a registered partner |
| Tax preparation help | Big savings, high trust | Tax counsel; partner filing service |
| Credit score monitoring | Context for card and loan findings | A credit bureau partner and FCRA review |
