# Stage 4 partners: what's built, and what it still needs

**All off.** None of these has been run against a real API: no keys, sign-ups or live calls. Each is built from the provider's docs and tested against a mock, and no code selects one: every sector's "which partner" function still gives only its stand-in, for sample data. Real accounts behave as they do today. Picks and evidence come from `connector-plan.md` in the shared notes. Not legal advice.

| Area | Picked | Built | What the sector's interface can't do through it |
|---|---|---|---|
| Credit | Spinwheel | `src/lib/credit/spinwheel.ts` | Keeps Jane's own score simulator, since it has none. A range by model. Collections are listed, never acted on |
| Tax filing | Column Tax | `src/lib/filing/column-tax.ts` | The person signs in Column's own screen, so `submitReturn` refuses. `createAmendment` refuses: amendments aren't documented. Prefills only some fields |
| Insurance quotes | Coverage Cat | `src/lib/insurance/coverage-cat.ts` | Quotes only, in 5 states. Everything else is "the broker handles this" |
| Insurance data | Canopy | `src/lib/insurance/canopy.ts` | Read-only. Not needed for the beta: a declarations page upload already works |
| Investing, advice | A Jane-owned registered adviser | `src/lib/investments/adviser.ts` | An interface only. `REAL_ACCOUNT_ADVICE` false refuses it whatever partner is given |
| Investing, orders | Alpaca | `src/lib/brokerage/alpaca.ts` | Can't place an order: `RealTradingOff`. Builds the order's shape only, and crypto is refused first |
| Payroll | None | stays a stand-in | No payroll vendor documents a 401(k) change. Draft it, and the person sends it |

## What only the founders can do

**Everyone:** form the legal entity, hire counsel. Prices aren't public for Spinwheel, Column Tax or Canopy's production tier, and no vendor says it takes a two-student pre-revenue company: ask.

**Credit:** a contract with Spinwheel. Counsel on its conflicting status (a consumer reporting agency in March 2026, "neither" in its addendum), permissible purpose, the consent wording, whether its data can go to Claude (its docs don't say), its 90-day purge, and credit repair rules before acting on collections.

**Tax:** a sandbox by email to Column Tax, then a contract. Counsel on IRS section 7216 consent. Ask about 1040-X. Time it for the filing season.

**Insurance:** counsel on referrals before `COUNSEL_INSURANCE_REFERRALS.approved` changes. California treats recommending a policy as licensed activity, so Jane's words must not. Any commission arrangement is for counsel. Coverage Cat's terms page returned 404, so its terms are unread.

**Investing:** a registered adviser first: a California state registration needs a principal with a Series 65 or a CFP/CFA waiver. Real orders would then need Alpaca's business agreement and a clearing deposit. Both are decisions for after funding, and `REAL_ACCOUNT_ADVICE` and `REAL_TRADING` change only with counsel's sign-off.

## Still to build, once there's a contract

Onboarding and consent screens, webhooks, and wiring each one into its sector's "which partner" function, with the permission check around anything that acts. Hidden pages come back only as each area's gate opens (`src/config/hidden-pages.ts`).
