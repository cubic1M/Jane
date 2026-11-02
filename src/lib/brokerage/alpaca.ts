import { refuseCrypto, type BrokeragePartner, type OrderRequest } from "./partner";

// Orders through Alpaca's Broker API. **NEVER RUN against its API, and it can't place an order**:
// built from its docs, read 2026-11-02 (docs.alpaca.markets: createorderforaccount), and tested
// against a mock. brokeragePartner (./partner.ts) stays simulated, and REAL_TRADING is false: no real
// trading. The trading agent's 0 of 170 runs beat holding, so investing work goes to fees and leaks.
// Recommendations come first, through a registered adviser (src/lib/investments/adviser.ts).

export const ALPACA_SANDBOX = "https://broker-api.sandbox.alpaca.markets";

export class RealTradingOff extends Error {
  constructor() {
    super("Jane doesn't place real orders.");
    this.name = "RealTradingOff";
  }
}

// What an order would be, by dollar amount. Crypto never gets this far.
export function alpacaOrderBody(order: OrderRequest) {
  refuseCrypto([order]);
  if (order.side === "deposit") throw new Error("A deposit isn't an order.");
  return {
    symbol: order.ticker,
    notional: (order.amountCents / 100).toFixed(2),
    side: order.side,
    type: "market",
    time_in_force: "day",
  };
}

export function alpacaPartner(): BrokeragePartner {
  return {
    name: "Alpaca",
    simulated: false,
    async priceOf() {
      return null;
    },
    async placeOrders(_userId, { orders }) {
      refuseCrypto(orders);
      // Nothing past this line exists. Sending an order is a later change, with REAL_TRADING.
      throw new RealTradingOff();
    },
  };
}
