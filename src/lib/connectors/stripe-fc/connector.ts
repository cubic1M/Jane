import { STRIPE_FC } from "@/config/connectors";
import type { Connector, LinkEvent } from "../types";

// The signing its webhook uses: Stripe-Signature, "t=,v1=" over `${t}.${body}`.
export const STRIPE_FC_SIGNING = {
  kind: "hmac_sha256_tv",
  secretEnv: STRIPE_FC.secretEnv,
  header: STRIPE_FC.signatureHeader,
} as const;

// Stripe's Financial Connections events (docs.stripe.com/api/events/types, checked 2026-11-06), as
// link events on the account they're about (data.object, a financial_connections.account, whose id
// is the link's): a refresh counts only when it succeeded; disconnected or deactivated means the
// link needs relinking; reactivated, that it works again. Anything else is ignored.
const CHANGES: Readonly<Record<string, LinkEvent["change"]>> = {
  "financial_connections.account.refreshed_transactions": "refreshed",
  "financial_connections.account.refreshed_balance": "refreshed",
  "financial_connections.account.disconnected": "disconnected",
  "financial_connections.account.deactivated": "disconnected",
  "financial_connections.account.reactivated": "reconnected",
};
const REFRESH_FIELD: Readonly<Record<string, string>> = {
  "financial_connections.account.refreshed_transactions": "transaction_refresh",
  "financial_connections.account.refreshed_balance": "balance_refresh",
};

export function parseStripeFcEvent(body: unknown): LinkEvent | null {
  const event = (body ?? {}) as { id?: unknown; type?: unknown; data?: { object?: unknown } };
  const type = typeof event.type === "string" ? event.type : "";
  const change = CHANGES[type];
  const account = (event.data?.object ?? {}) as Record<string, unknown>;
  if (!change || typeof account.id !== "string" || !account.id.startsWith("fca_")) return null;
  const field = REFRESH_FIELD[type];
  if (field) {
    const refresh = account[field] as { status?: unknown } | null | undefined;
    if (refresh?.status !== "succeeded") return null;
  }
  return {
    kind: "link",
    eventId: typeof event.id === "string" ? event.id : "",
    linkRef: account.id,
    change,
  };
}

// Stripe Financial Connections (connectors roadmap round 20): the second bank-data source, read only,
// behind the same consent as Plaid. It reaches nobody until Stripe approves Jane's purpose and
// REAL_CONNECTORS turns it on. Its webhook says when an account's data is fresh or its link broke.
export const stripeFc: Connector = {
  id: "stripe_fc",
  name: "Your bank accounts, through Stripe",
  category: "bank_data",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: false,
  movesMoney: false,
  webhook: { signing: STRIPE_FC_SIGNING, parse: parseStripeFcEvent },
};
