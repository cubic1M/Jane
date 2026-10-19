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
- CSV import of the founders' own data first; Plaid Node SDK (Transactions)
  added in step 7 behind the same DataSource interface; Liabilities (read-only,
  optional product) from step 65
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
- Demo advice exception (step 98): when adviceMode(userId) in src/lib/advice-mode.ts
  is true (every account is the demo bank; in production only with DEMO_ADVICE=1),
  recommendations on investments, taxes, insurance and loans may be shown, checked
  with the "demo_advice" guardrail profile (unsupported figures, promised outcomes
  and legal advice stay blocked) and always labelled "Demo advice: sample data, not
  financial advice" (DEMO_ADVICE_LABEL, DemoAdviceLabel, refs.advice in the chat).
  Real accounts never get advice: REAL_ACCOUNT_ADVICE in src/config/advice.ts stays
  false until a licensed partner is connected and counsel signs off
- Trial people (step 138, ids starting "trial_", src/lib/trial.ts) are sample data:
  never emailed, never contact a company (the agent uses the simulated company and
  number), never in analytics or metrics, and deleted after TRIAL_HOURS
- Write tests for every rule and every API route you add
- Prefer small, readable modules over clever abstractions
- When unsure about a Plaid field or category name, check the Plaid docs instead
  of guessing

## Commands
- npm run dev / npm test / npm run test:e2e / npm run lint / npx prisma migrate dev
