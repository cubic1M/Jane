import { ALPACA } from "@/config/connectors";
import { refuseCrypto } from "@/lib/brokerage/partner";

// Alpaca's Broker API, the parts the sandbox adapter is shaped by (docs.alpaca.markets: Getting
// Started with Broker API, Create an Order for an Account, Cancel an Open Order, read 2026-11-17):
// HTTP Basic auth with the correspondent's key and secret; POST
// /v1/trading/accounts/{account_id}/orders with a dollar amount (`notional`, fractional shares) and
// Jane's own client_order_id, so a retry can't buy twice; DELETE .../orders/{order_id} cancels an
// open one (204), and 422 means it can no longer be. NEVER RUN against Alpaca from Jane: there is
// no real Alpaca connector (./connector.ts) and REAL_TRADING is false. Built so the day a broker
// agreement exists is a registration and a review, not a build.

export type AlpacaOrder = { id: string; status: string };

export type AlpacaBuy = {
  accountId: string;
  symbol: string;
  amountCents: number;
  // Jane's action, as Alpaca's client_order_id.
  clientOrderId: string;
};

export interface AlpacaBroker {
  buy(order: AlpacaBuy): Promise<AlpacaOrder>;
  cancel(accountId: string, orderId: string): Promise<boolean>;
}

export class AlpacaError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Alpaca request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "AlpacaError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The order Alpaca's reference asks for: a market buy by dollar amount, for the day. Crypto never
// gets this far (spec step 161).
export function buyBody(order: AlpacaBuy) {
  refuseCrypto([
    {
      accountId: order.accountId,
      ticker: order.symbol,
      securityName: order.symbol,
      side: "buy",
      amountCents: order.amountCents,
    },
  ]);
  if (!Number.isSafeInteger(order.amountCents) || order.amountCents < 100) {
    throw new AlpacaError(null, "BAD_AMOUNT");
  }
  return {
    symbol: order.symbol,
    notional: (order.amountCents / 100).toFixed(2),
    side: "buy",
    type: "market",
    time_in_force: "day",
    client_order_id: order.clientOrderId,
  };
}

type HttpOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch };

export function alpacaBrokerHttp({
  env = process.env,
  fetch: send = fetch,
}: HttpOptions = {}): AlpacaBroker {
  // The sandbox host, always: nothing here may reach production while REAL_TRADING is false.
  const base = ALPACA.sandbox;
  const auth = () => {
    const key = env[ALPACA.keyEnv];
    const secret = env[ALPACA.secretEnv];
    if (!key || !secret) throw new AlpacaError(null, "NOT_CONFIGURED");
    return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  };
  const checkIds = (...ids: string[]) => {
    if (!ids.every((id) => UUID.test(id))) throw new AlpacaError(null, "BAD_ID");
  };
  return {
    async buy(order) {
      checkIds(order.accountId);
      const body = buyBody(order);
      const response = await send(`${base}/v1/trading/accounts/${order.accountId}/orders`, {
        method: "POST",
        headers: {
          authorization: auth(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const placed = (await response.json().catch(() => null)) as {
        id?: unknown;
        status?: unknown;
      } | null;
      if (!response.ok || typeof placed?.id !== "string")
        throw new AlpacaError(response.status, "REFUSED");
      return { id: placed.id, status: typeof placed.status === "string" ? placed.status : "" };
    },
    async cancel(accountId, orderId) {
      checkIds(accountId, orderId);
      const response = await send(`${base}/v1/trading/accounts/${accountId}/orders/${orderId}`, {
        method: "DELETE",
        headers: { authorization: auth() },
      });
      if (response.status === 422) return false;
      if (!response.ok) throw new AlpacaError(response.status, "REFUSED");
      return true;
    },
  };
}
