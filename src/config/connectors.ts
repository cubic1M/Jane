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
} as const;
export type ConsentScope = keyof typeof CONSENT_SCOPES;

export const isConsentScope = (scope: unknown): scope is ConsentScope =>
  typeof scope === "string" && Object.hasOwn(CONSENT_SCOPES, scope);
