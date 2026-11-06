import { TRANSFER_DELAY_DAYS } from "./money-movement";

// Connectors (docs/connectors.md): the partners Jane reads from, prefills for and, later, acts through.
// Everything here is off in production. Three locks, all needed before a real connector acts:
//
// 1. CONNECTORS: the env var, exactly "1". Off, every connector route answers 404 and the action
//    pipeline refuses everything, sandbox included.
// 2. REAL_CONNECTORS: per real connector, in code. A sandbox adapter needs no entry: it reaches nobody.
// 3. REAL_MONEY_MOVEMENT (./money-movement.ts): a real connector that moves money needs it as well.
//
// KILL_CONNECTORS (./kill-switches.ts) and CONNECTORS_KILLED stop them again in seconds.

export const connectorsOn = (env: Record<string, string | undefined> = process.env): boolean =>
  env.CONNECTORS?.trim() === "1";

// Ids of connectors stopped by env, comma-separated, e.g. CONNECTORS_KILLED=bill_pay,insurance_quote.
export function connectorsKilledByEnv(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const raw = env.CONNECTORS_KILLED ?? "";
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

// The real connectors that may act, by id. None until a partner is signed, counsel has answered and
// the founders say so. Turning one on is a code change, never an env var (registry.test.ts checks).
export const REAL_CONNECTORS: Readonly<Record<string, boolean>> = {};

export type ConnectorCategory =
  | "bank_data"
  | "bills"
  | "own_transfer"
  | "subscriptions"
  | "insurance"
  | "credit"
  | "tax"
  | "investing"
  | "payroll";

// read: Jane reads data. prefill: Jane fills in the steps for the person. act: Jane carries them out
// after the person's yes.
export type ConnectorCapability = "read" | "prefill" | "act";

// What a person consents to, with the words the settings page shows. A connector names the scopes it
// needs; an action runs only while the person's consent covers every one.
export const CONSENT_SCOPES = {
  read_accounts: "See your accounts and balances",
  read_bills: "See your bills and due dates",
  read_policies: "See your insurance policies",
  prefill_payments: "Fill in payments for you to approve",
  pay_bills: "Pay a bill, after your yes on that payment",
  move_own_money: "Move money between your own accounts, after your yes on that move",
  cancel_subscriptions: "Cancel a subscription, after your yes",
  request_quotes: "Ask for insurance quotes in your name, after your yes",
  // From the connectors roadmap's gaps (2026-11-06), for Stage 2 and later connectors.
  contact_companies: "Email or write to a company for you, after your yes",
  call_companies: "Call a company's customer service for you, after your yes",
  record_calls: "Record those calls (each call says so at the start)",
  share_with_partner: "Share the details a partner needs for a quote or offer",
  read_credit: "See your credit report and score",
  soft_credit_pull: "Let a partner check your credit without affecting your score",
  ach_debit_authorization: "Let a partner take a payment from your bank account, as you authorize",
  tax_7216_disclosure: "Share your tax information with a tax partner, for the use you choose",
  place_orders: "Place investment orders, after your yes on each",
  open_accounts: "Open an account in your name with a partner, after your yes",
} as const;
export type ConsentScope = keyof typeof CONSENT_SCOPES;

// Scopes whose consent is a legal text, not our words: FCRA's written instruction for a soft pull,
// Nacha's debit authorization, IRS 7216's disclosure consent. A connector asking for one must carry
// the exact text its partner and counsel approved (Connector.consentText), and granting stores that
// text as shown. Jane never writes these.
export const EXACT_TEXT_SCOPES: readonly ConsentScope[] = [
  "soft_credit_pull",
  "ach_debit_authorization",
  "tax_7216_disclosure",
];

export const isConsentScope = (scope: unknown): scope is ConsentScope =>
  typeof scope === "string" && Object.hasOwn(CONSENT_SCOPES, scope);

// --- The action pipeline (src/lib/connectors/pipeline.ts) ---------------------------------------

// The most one action may move or commit. Above it the pipeline refuses, whatever the yes says. Kept
// low for the first partner: a typical bill or a move between own accounts, not rent.
export const CONNECTOR_ACTION_CAP_CENTS = 100_000;
// Per person per rolling 24 hours: how many actions may be approved or run, and how much in all.
export const CONNECTOR_DAILY_ACTIONS = 5;
export const CONNECTOR_DAILY_CENTS = 200_000;

// How long after the yes an action waits before it runs, so the person can still cancel it in Jane.
// Money keeps the one-day undo the money-movement stand-in already promises (TRANSFER_DELAY_DAYS);
// anything else waits a few minutes, enough to catch a wrong tap.
export const CONNECTOR_HOLD_MINUTES = {
  money: TRANSFER_DELAY_DAYS * 24 * 60,
  other: 10,
} as const;

// A plan the person hasn't answered within this long expires: the yes is for what they saw then.
export const CONNECTOR_PLAN_HOURS = 72;

// --- Webhooks (src/lib/connectors/webhooks.ts) ---------------------------------------------------

// A signed delivery older or newer than this is refused, as Stripe's and Svix's defaults do.
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
// The most a delivery may be. Partners send small JSON events.
export const WEBHOOK_MAX_BYTES = 64 * 1024;
// How long an event id is remembered, to refuse a replay. Far longer than any provider retries
// (Svix retries for about 28 hours, Stripe for 3 days).
export const WEBHOOK_EVENT_DAYS = 30;

// --- "Jane prepares, you pay" (src/lib/connectors/manual-pay/) ------------------------------------

// Pay this many business days before the due date, so it posts in time (roadmap round 8: most
// billers credit the same day, a bank's own bill pay can take five).
export const MANUAL_PAY_LEAD_BUSINESS_DAYS = 3;
export const MANUAL_PAY_BANK_BILL_PAY_LEAD_BUSINESS_DAYS = 5;
// The latest cutoff most billers share for same-day credit (Chase Home Lending's is 7:30 PM ET).
export const MANUAL_PAY_CUTOFF = "7 PM ET";
// An autopay line from the biller in this many days means autopay is on: no manual payment then.
export const MANUAL_PAY_AUTOPAY_LOOKBACK_DAYS = 45;
// A move between the person's own accounts at one bank is instant; between banks, ACH takes up to
// three business days to show on both sides.
export const MANUAL_TRANSFER_SETTLE_BUSINESS_DAYS = 3;
// A new savings bank pulls the opening deposit by ACH once the person links their account: about
// one to three business days after they open it (round 13); five to allow a slow sign-up.
export const MANUAL_SAVINGS_SETTLE_BUSINESS_DAYS = 5;

// --- A person's own credit report (src/lib/connectors/credit-upload.ts) ---------------------------

// Scores the person can type in, by the model their free source shows, with the model's range
// (roadmap round 9: Experian's free membership shows FICO Score 8; Chase Credit Journey and Capital
// One CreditWise show VantageScore 3.0). Ranges are the models' published 300-850.
export const CREDIT_SCORE_MODELS = {
  fico_8: { label: "FICO Score 8", low: 300, high: 850 },
  vantagescore_3: { label: "VantageScore 3.0", low: 300, high: 850 },
  vantagescore_4: { label: "VantageScore 4.0", low: 300, high: 850 },
} as const;
export type CreditScoreModel = keyof typeof CREDIT_SCORE_MODELS;
// A typed-in score older than this isn't saved: free sources refresh monthly.
export const CREDIT_SCORE_MAX_AGE_DAYS = 45;
