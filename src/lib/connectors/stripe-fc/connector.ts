import { STRIPE_FC } from "@/config/connectors";
import type { Connector } from "../types";

// Stripe Financial Connections (connectors roadmap round 20): the second bank-data source, read only,
// behind the same consent as Plaid. Registered so its consent, switch and kill switch exist; it reads
// nothing yet and reaches nobody until Stripe approves Jane's purpose and REAL_CONNECTORS turns it
// on. Its refresh webhook is about data, not an action, so it waits for the data-event path.
export const stripeFc: Connector = {
  id: "stripe_fc",
  name: "Your bank accounts, through Stripe",
  category: "bank_data",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  sandbox: false,
  movesMoney: false,
};

// The signing its webhook uses, for when the data-event path takes it.
export const STRIPE_FC_SIGNING = {
  kind: "hmac_sha256_tv",
  secretEnv: STRIPE_FC.secretEnv,
  header: STRIPE_FC.signatureHeader,
} as const;
