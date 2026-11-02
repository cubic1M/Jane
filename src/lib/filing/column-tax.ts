import { createHmac, timingSafeEqual } from "node:crypto";
import { requireGrant } from "@/lib/permission/gate";
import type { FilingPartner, PartnerStatus, ReturnPackage, ReturnPreview } from "./types";

// Filing through Column Tax. **NEVER RUN against Column Tax's API**: built from its docs, read
// 2026-11-02 (docs.columntax.com: express-initialize-tax-filing, webhook-events, tax-returns), and
// tested against a mock. Off: filingPartnerFor (./index.ts) only ever gives the demo stand-in.
//
// Column files in its own screen: the person finishes and signs there, so there's no submit to make
// here, and Jane can't sign for them. It only prefills some fields (not Jane's tags, deductions or
// collected forms). It doesn't document amended returns. Before live use: IRS section 7216 consent
// for tax data, the sandbox (by email to them, not self-serve), and whether HMAC-SHA256 is right for
// its webhooks: its docs say HMAC and point to Svix's guides, without naming the hash.

export const COLUMN_SANDBOX = "https://sandbox.columnapi.com";

export class FilesInPartnerScreen extends Error {
  constructor() {
    super("The person finishes and signs this return in the partner's own screen.");
    this.name = "FilesInPartnerScreen";
  }
}

export class AmendmentNotSupported extends Error {
  constructor() {
    super("This partner doesn't document amended returns.");
    this.name = "AmendmentNotSupported";
  }
}

// The person's details Column needs, from Jane's account. Sign-in facts its API asks for.
export type ColumnUser = {
  id: string;
  email: string;
  metadata: {
    password_changed_date: string | null;
    account_locked_date: string | null;
    passed_mfa_at_this_login: boolean;
    failed_login_attempts: number;
    cell_phone_changed_date: string | null;
    email_changed_date: string | null;
  };
};

// What of a return package its prefill can take: estimated payments. W-2s and the rest need fields
// Jane doesn't keep from a statement, so the person fills them in on Column's screen.
export function prefillOf(pkg: ReturnPackage) {
  const quarter = Math.round(pkg.estimatedPayments.federalCents / 4);
  return pkg.estimatedPayments.federalCents > 0
    ? {
        federal_estimated_quarterly_payments: {
          estimated_tax_payment_1_amount_cents: quarter,
          estimated_tax_payment_2_amount_cents: quarter,
          estimated_tax_payment_3_amount_cents: quarter,
          estimated_tax_payment_4_amount_cents: pkg.estimatedPayments.federalCents - quarter * 3,
        },
      }
    : {};
}

const STATUS: Readonly<Record<string, PartnerStatus>> = {
  submitted: "submitted",
  accepted: "accepted",
  rejected: "rejected",
};

// Its submission statuses, as Jane's. "retryable" can be fixed and sent again, so it isn't final; an
// unknown one is treated the same, as its docs say more may be added.
export const statusOf = (value: string): PartnerStatus => STATUS[value] ?? "submitted";

export function verifyColumnWebhook(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(
    createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64"),
  );
  return signature.split(" ").some((entry) => {
    const given = Buffer.from(entry.split(",")[1] ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function columnTaxPartner({
  apiKey,
  user,
  fetcher,
  statusFor,
  baseUrl = COLUMN_SANDBOX,
}: {
  // The credentials its Basic auth takes, already encoded.
  apiKey: string;
  user: ColumnUser;
  // Given, never the global fetch: nothing here can reach the network unless a caller means it to.
  fetcher: typeof fetch;
  // What its webhook last said (tax_return.submission_status_changed): it has no status to fetch.
  statusFor: (partnerReturnId: string) => Promise<string>;
  baseUrl?: string;
}): FilingPartner & { filingUrl(pkg: ReturnPackage): Promise<string> } {
  const initialize = async (pkg: ReturnPackage) => {
    requireGrant("filing");
    const response = await fetcher(`${baseUrl}/v1/exp/initialize_tax_filing`, {
      method: "POST",
      headers: { authorization: `Basic ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        user_identifier: user.id,
        user: { email: user.email },
        user_metadata: user.metadata,
        ...prefillOf(pkg),
      }),
    });
    if (!response.ok) throw new Error(`Column Tax answered ${response.status}`);
    return (await response.json()) as { user_identifier: string; user_url: string };
  };
  return {
    name: "Column Tax",
    async createReturn(pkg: ReturnPackage, preview: ReturnPreview) {
      const { user_identifier: partnerReturnId } = await initialize(pkg);
      // Jane's own preview: Column's estimate comes once the person is in its screen.
      return { partnerReturnId, preview };
    },
    // Where the person finishes and signs. Short-lived: asked for each time.
    async filingUrl(pkg) {
      return (await initialize(pkg)).user_url;
    },
    async createAmendment() {
      throw new AmendmentNotSupported();
    },
    async submitReturn() {
      throw new FilesInPartnerScreen();
    },
    async status(partnerReturnId) {
      return statusOf(await statusFor(partnerReturnId));
    },
  };
}
