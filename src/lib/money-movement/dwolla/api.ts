import { DWOLLA_SANDBOX } from "@/config/money-movement";

// Dwolla's API, the part a me-to-me transfer needs (developers.dwolla.com, read 2026-11-19: "Create
// an application access token", "Initiate a transfer", "Retrieve a transfer", "Cancel a transfer",
// "Transfer Lifecycle" and "Testing in the Sandbox"), on the Sandbox host only.
// - POST /token, Basic key:secret, grant_type=client_credentials: { access_token, expires_in }.
// - POST /transfers with _links.source/destination (funding-source hrefs), amount { value "1.00",
//   currency USD }, correlationId (1 to 255 characters) and an Idempotency-Key: 201 and a Location
//   header, the new transfer's URL.
// - GET /transfers/{id}: status pending, processed, cancelled or failed.
// - POST /transfers/{id} { status: "cancelled" }: only while pending; 400 once processing began.
// The Sandbox runs no ACH: a transfer stays pending until a Sandbox simulation processes it.

export type DwollaStatus = "pending" | "processed" | "cancelled" | "failed";

export interface DwollaApi {
  // The new transfer's id.
  createTransfer(transfer: {
    sourceHref: string;
    destinationHref: string;
    amountCents: number;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<string>;
  transferStatus(transferId: string): Promise<DwollaStatus | null>;
  // False when Dwolla says it can't be cancelled any more.
  cancelTransfer(transferId: string): Promise<boolean>;
}

// Dwolla said no (its HTTP status) or the key isn't set. Never carries the key, secret or body.
export class DwollaError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Dwolla request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "DwollaError";
  }
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const TRANSFER_ID = new RegExp(`^${UUID}$`);
const FUNDING_SOURCE = new RegExp(
  `^${DWOLLA_SANDBOX.base.replace(/[.]/g, "\\.")}/funding-sources/${UUID}$`,
);
const LOCATION = new RegExp(`^${DWOLLA_SANDBOX.base.replace(/[.]/g, "\\.")}/transfers/(${UUID})$`);
const STATUSES = new Set<string>(["pending", "processed", "cancelled", "failed"]);

// "1234" cents as Dwolla's "12.34".
export const dollars = (cents: number) =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

type HttpOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
};

export function dwollaSandboxHttp({
  env = process.env,
  fetch: send = fetch,
  now = Date.now,
}: HttpOptions = {}): DwollaApi {
  let token: { value: string; until: number } | null = null;

  async function bearer(): Promise<string> {
    if (token && now() < token.until) return token.value;
    const key = env[DWOLLA_SANDBOX.keyEnv];
    const secret = env[DWOLLA_SANDBOX.secretEnv];
    if (!key || !secret) throw new DwollaError(null, "NOT_CONFIGURED");
    const response = await send(`${DWOLLA_SANDBOX.base}/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!response.ok || typeof body?.access_token !== "string") {
      throw new DwollaError(response.status, "TOKEN_REFUSED");
    }
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
    token = {
      value: body.access_token,
      until: now() + (seconds - DWOLLA_SANDBOX.tokenMarginSeconds) * 1000,
    };
    return token.value;
  }

  const headers = async (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${await bearer()}`,
    accept: DWOLLA_SANDBOX.mediaType,
    "content-type": DWOLLA_SANDBOX.mediaType,
    ...extra,
  });

  return {
    async createTransfer({
      sourceHref,
      destinationHref,
      amountCents,
      correlationId,
      idempotencyKey,
    }) {
      if (!FUNDING_SOURCE.test(sourceHref) || !FUNDING_SOURCE.test(destinationHref)) {
        throw new DwollaError(null, "BAD_FUNDING_SOURCE");
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new DwollaError(null, "BAD_AMOUNT");
      }
      if (correlationId.length < 1 || correlationId.length > DWOLLA_SANDBOX.correlationIdMax) {
        throw new DwollaError(null, "BAD_CORRELATION_ID");
      }
      const response = await send(`${DWOLLA_SANDBOX.base}/transfers`, {
        method: "POST",
        headers: await headers({ "idempotency-key": idempotencyKey }),
        body: JSON.stringify({
          _links: { source: { href: sourceHref }, destination: { href: destinationHref } },
          amount: { value: dollars(amountCents), currency: "USD" },
          correlationId,
        }),
      });
      const id = LOCATION.exec(response.headers.get("location") ?? "")?.[1];
      if (response.status !== 201 || !id) throw new DwollaError(response.status, "REFUSED");
      return id;
    },

    async transferStatus(transferId) {
      if (!TRANSFER_ID.test(transferId)) throw new DwollaError(null, "BAD_ID");
      const response = await send(`${DWOLLA_SANDBOX.base}/transfers/${transferId}`, {
        headers: await headers(),
      });
      const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
      if (!response.ok) throw new DwollaError(response.status, "REFUSED");
      return typeof body?.status === "string" && STATUSES.has(body.status)
        ? (body.status as DwollaStatus)
        : null;
    },

    async cancelTransfer(transferId) {
      if (!TRANSFER_ID.test(transferId)) throw new DwollaError(null, "BAD_ID");
      const response = await send(`${DWOLLA_SANDBOX.base}/transfers/${transferId}`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (response.ok) return true;
      // Too late: processing began (400), or Dwolla has no such transfer (404).
      if (response.status === 400 || response.status === 404) return false;
      throw new DwollaError(response.status, "REFUSED");
    },
  };
}
