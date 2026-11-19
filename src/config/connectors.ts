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

// Whether a qualified person reviews each personalized investment or tax recommendation before a
// real person sees it, with the authority to change it (Anthropic's Usage Policy from 2026-11-12,
// "High-risk AI Recommendations"; connectors roadmap round 13). Until that review exists, no
// connector that recommends (Connector.recommends) serves a real person. Code only, never an env
// var; sample data isn't a real person's and isn't held back.
export const HUMAN_REVIEW_READY = false;

// Whether any connector may place a real order in a real brokerage account. Code only, never an env
// var: a broker agreement, counsel on whether suggesting and placing an order needs a broker or
// adviser registration, and the founders' word come first. The Alpaca adapter is sandbox only
// (src/lib/connectors/alpaca/).
export const REAL_TRADING = false;

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
  | "payroll"
  // A letter the person signs that lets Jane act for them (./signwell).
  | "permission";

// read: Jane reads data. prefill: Jane fills in the steps for the person. act: Jane carries them out
// after the person's yes.
export type ConnectorCapability = "read" | "prefill" | "act";

// What a person consents to, with the words the settings page shows. A connector names the scopes it
// needs; an action runs only while the person's consent covers every one.
export const CONSENT_SCOPES = {
  read_accounts: "See your accounts and balances",
  read_bills: "See your bills and due dates",
  read_policies: "See your insurance policies",
  read_holdings: "See your investment accounts and what they hold",
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
  read_pay: "See your pay stubs and who you work for",
  soft_credit_pull: "Let a partner check your credit without affecting your score",
  ach_debit_authorization: "Let a partner take a payment from your bank account, as you authorize",
  tax_7216_disclosure: "Share your tax information with a tax partner, for the use you choose",
  place_orders: "Place investment orders, after your yes on each",
  open_accounts: "Open an account in your name with a partner, after your yes",
  sign_letters:
    "Send you a letter to sign that lets Jane act for you with a company, after your yes",
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

// Stripe Financial Connections (connectors roadmap round 20; Teller withdrew its API in July 2026):
// a second bank-data source behind Plaid, read only. Checking, savings, card and loan accounts, no
// investments or liability details, at most 180 days of transactions, refreshed daily with a webhook
// (Stripe-Signature, "t=,v1=" over `${t}.${body}`). Balances cost $0.10 a call, so they're refreshed
// at most weekly, never on a page view; transactions $0.30 per bank, per person, per month. Off
// until Stripe approves Jane's purpose in writing (REAL_CONNECTORS). Its terms: data shared only with
// service providers bound by consistent obligations, stored in the US, consent records kept 24
// months after the contract ends.
// Canopy Connect (read connectors, 11-18; docs.usecanopy.com/reference, read 2026-11-17): the
// person signs in to their insurer through Canopy's hosted link, and Canopy's "pull" lists their
// policies. One API for sandbox and production, the team's keys deciding which (Basic auth: client
// id and secret). Webhooks are signed in one canopy-signature header, "t=<seconds>,s=<hex>",
// HMAC-SHA256 over `${t}.${body}`, and carry no event id.
export const CANOPY = {
  baseUrl: "https://app.usecanopy.com/api/v1.0.0",
  clientIdEnv: "CANOPY_CLIENT_ID",
  clientSecretEnv: "CANOPY_CLIENT_SECRET",
  teamIdEnv: "CANOPY_TEAM_ID",
  webhookSecretEnv: "CANOPY_WEBHOOK_SECRET",
  signatureHeader: "canopy-signature",
} as const;

// PostGrid's Print & Mail API in test mode (batch-2 connectors; postgrid.readme.io, read 2026-11-19:
// Create Letter, Cancel Letter, Getting Started, Manually Verifying Webhook Signatures). "None of the
// orders made in test mode will be sent out": only the test key is read here, a letter must come back
// `live: false`, and certified mail can be stopped while it's `ready`. Webhooks:
// "PostGrid-Signature: t=<unix milliseconds>,v1=<hex>" over `${t}.${body}`.
export const POSTGRID = {
  baseUrl: "https://api.postgrid.com",
  lettersPath: "/print-mail/v1/letters",
  testApiKeyEnv: "POSTGRID_TEST_API_KEY",
  webhookSecretEnv: "POSTGRID_WEBHOOK_SECRET",
  signatureHeader: "PostGrid-Signature",
  mailingClass: "certified",
  // The return address on a test letter: PostGrid's own documented example contact (Create Letter),
  // verbatim (its zip and city disagree there too; test mode verifies no address), since Jane keeps no
  // mailing address for a person. A real letter needs the person's own.
  testSender: {
    addressLine1: "90 CANAL ST STE 600",
    city: "BOSTON",
    provinceOrState: "MA",
    postalOrZip: "90210-1234",
    countryCode: "US",
  },
} as const;

// Chart (read connectors, 11-18; developer.trychart.com and its OpenAPI definition, read
// 2026-11-17): IRS account transcripts and past returns. Sandbox only until counsel answers
// whether a person may type their IRS login into a third party (src/lib/connectors/chart/).
export const CHART = {
  baseUrl: "https://api.trychart.com",
  apiVersion: "2024-01-01",
  clientIdEnv: "CHART_CLIENT_ID",
  clientSecretEnv: "CHART_CLIENT_SECRET",
} as const;

// Pinwheel (read connectors, batch 2; docs.pinwheelapi.com, read 2026-11-19: API Overview, Core Data
// Technical Implementation, Webhook Signature Verification, Sandbox): a person's pay stubs and
// employer, read through their payroll login. One host per mode; Jane uses Sandbox unless
// PINWHEEL_ENV says development or production. Every request carries `x-api-secret` and
// `Pinwheel-Version`. Webhooks: `x-pinwheel-signature: v2=<hex>`, HMAC-SHA256 with the API secret over
// "v2:<x-timestamp>:<raw body>".
export const PINWHEEL = {
  hosts: {
    sandbox: "https://sandbox.getpinwheel.com",
    development: "https://development.getpinwheel.com",
    production: "https://api.getpinwheel.com",
  },
  version: "2025-07-08",
  envEnv: "PINWHEEL_ENV",
  apiSecretEnv: "PINWHEEL_API_SECRET",
  signatureHeader: "x-pinwheel-signature",
  timestampHeader: "x-timestamp",
  // Pay stubs read at a time: enough to tell how often the person is paid.
  paystubLimit: 3,
} as const;

// SignWell (read connectors, 11-18; developers.signwell.com, read 2026-11-17): a letter the person
// signs to let Jane act for them with one company. X-Api-Key auth; SIGNWELL_ENV=production sends
// binding documents, anything else test-mode ones. Its webhooks carry an event hash: HMAC-SHA256
// keyed by the webhook's id over "<type>@<time>".
export const SIGNWELL = {
  baseUrl: "https://www.signwell.com",
  envEnv: "SIGNWELL_ENV",
  apiKeyEnv: "SIGNWELL_API_KEY",
  webhookIdEnv: "SIGNWELL_WEBHOOK_ID",
  // Days before an unsigned letter's request expires.
  expiresInDays: 14,
} as const;

// Alpaca's Broker API (read connectors, 11-18; docs.alpaca.markets, read 2026-11-17): sandbox only.
// HTTP Basic auth with the correspondent's key and secret.
export const ALPACA = {
  sandbox: "https://broker-api.sandbox.alpaca.markets",
  keyEnv: "ALPACA_BROKER_KEY_ID",
  secretEnv: "ALPACA_BROKER_SECRET_KEY",
} as const;

// Method (read connectors, batch 2; docs.methodfi.com, read 2026-11-19): a person's loans and cards,
// found through a soft-pull credit report on their verified identity, federal student loans
// included. Bearer key and a Method-Version header. Method's "Sandbox" environment carries live
// data; "Development" is the mocked one, so anything that isn't production uses Development.
// Webhooks: HMAC-SHA256 of "<method-webhook-timestamp>:<body>", hex, in method-webhook-signature.
export const METHOD = {
  development: "https://dev.methodfi.com",
  production: "https://production.methodfi.com",
  version: "2026-03-30",
  envEnv: "METHOD_ENV",
  apiKeyEnv: "METHOD_API_KEY",
  webhookSecretEnv: "METHOD_WEBHOOK_HMAC_SECRET",
  signatureHeader: "method-webhook-signature",
  timestampHeader: "method-webhook-timestamp",
  // Accounts read per page, Method's maximum; and pages at most, so a bad answer can't loop.
  pageLimit: 100,
  maxPages: 10,
} as const;

export const STRIPE_FC = {
  historyDays: 180,
  balanceRefreshDays: 7,
  balanceCallCents: 10,
  transactionsMonthlyCents: 30,
  consentRecordMonths: 24,
  signatureHeader: "stripe-signature",
  secretEnv: "STRIPE_FC_WEBHOOK_SECRET",
} as const;

// SnapTrade (read connectors, batch 2; docs.snaptrade.com, read 2026-11-19): a person's brokerage
// holdings, read only (the Connection Portal's `connectionType: "read"`, never trading). Every request
// is signed: clientId and timestamp in the query, and `Signature`, HMAC-SHA256 with the consumer key
// over the canonical JSON of { content, path, query }, base64 ("Request Signatures"). Webhooks carry
// `Signature` over the canonical JSON of their body, and an eventTimestamp checked like any other.
// Non-production (test) keys see SnapTrade's Sandbox brokerage; production keys don't.
export const SNAPTRADE = {
  baseUrl: "https://api.snaptrade.com",
  clientIdEnv: "SNAPTRADE_CLIENT_ID",
  consumerKeyEnv: "SNAPTRADE_CONSUMER_KEY",
  signatureHeader: "Signature",
  connectionType: "read",
  // Accounts read per person, at most; positions are read per account.
  maxAccounts: 25,
} as const;
