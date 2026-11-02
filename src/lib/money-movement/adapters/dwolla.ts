import { requireGrant } from "@/lib/permission/gate";
import { NotLinked, type PaymentAdapter } from "./types";

// Cash between a person's own accounts through Dwolla. **NEVER RUN against Dwolla's API**: built from
// its docs, read 2026-11-02 (developers.dwolla.com: transfer-money-me-to-me, initiate-a-transfer,
// cancel-a-transfer), and tested against a mock. Off: nothing selects it while REAL_MONEY_MOVEMENT is
// false, and PAYMENT_ROLLOUT.ownAccounts comes after bills.
//
// A move has two legs through the customer's Dwolla Balance, the second started by Dwolla, so it only
// counts as settled once that one is processed. Before live use: counsel on whether a Balance counts
// as money passing through Jane, and the token flow and full status list in its sandbox.

export const DWOLLA_SANDBOX = "https://api-sandbox.dwolla.com";
const HAL = "application/vnd.dwolla.v1.hal+json";

export function dwollaAdapter({
  key,
  secret,
  fetcher,
  baseUrl = DWOLLA_SANDBOX,
}: {
  key: string;
  secret: string;
  // Given, never the global fetch: nothing here can reach the network unless a caller means it to.
  fetcher: typeof fetch;
  baseUrl?: string;
}): PaymentAdapter {
  const token = async () => {
    const response = await fetcher(`${baseUrl}/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw new Error(`Dwolla answered ${response.status} to a token request`);
    return ((await response.json()) as { access_token: string }).access_token;
  };
  const headers = async () => ({
    authorization: `Bearer ${await token()}`,
    accept: HAL,
    "content-type": HAL,
  });
  const read = async (url: string) => {
    const response = await fetcher(url, { headers: await headers() });
    if (!response.ok) throw new Error(`Dwolla answered ${response.status} to a status check`);
    return (await response.json()) as {
      status?: unknown;
      _links?: Record<string, { href?: string } | undefined>;
    };
  };
  return {
    name: "dwolla",
    async send(request, { key: idempotencyKey, link }) {
      requireGrant("money_movement");
      const source = link("funding_source", request.fromAccountId);
      const destination = request.toAccountId ? link("funding_source", request.toAccountId) : null;
      if (!source) throw new NotLinked("the account it comes from");
      if (!destination) throw new NotLinked("the account it goes to");
      const response = await fetcher(`${baseUrl}/transfers`, {
        method: "POST",
        headers: { ...(await headers()), "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          _links: {
            source: { href: `${baseUrl}/funding-sources/${source}` },
            destination: { href: `${baseUrl}/funding-sources/${destination}` },
          },
          amount: { currency: "USD", value: (request.amountCents / 100).toFixed(2) },
        }),
      });
      const location = response.headers.get("location");
      if (response.status !== 201 || !location) {
        throw new Error(`Dwolla answered ${response.status} to a transfer`);
      }
      return { partnerRef: location.split("/").at(-1)! };
    },
    // Only while it's pending.
    async cancel(partnerRef) {
      const response = await fetcher(`${baseUrl}/transfers/${encodeURIComponent(partnerRef)}`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ status: "cancelled" }),
      });
      return response.ok;
    },
    async status(partnerRef) {
      const first = await read(`${baseUrl}/transfers/${encodeURIComponent(partnerRef)}`);
      if (first.status === "failed" || first.status === "cancelled") return "failed";
      if (first.status !== "processed") return "pending";
      // The first leg only reached the Balance: the money's there once the second has landed.
      const second = first._links?.["funded-transfer"]?.href;
      if (!second) return "pending";
      const landed = await read(second);
      if (landed.status === "failed" || landed.status === "cancelled") return "failed";
      return landed.status === "processed" ? "settled" : "pending";
    },
  };
}
