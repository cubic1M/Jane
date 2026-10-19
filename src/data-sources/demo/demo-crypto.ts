import { CRYPTO_ASSETS } from "@/config/crypto";
import { addDays } from "./demo-bank";
import { demoCryptoPrice } from "./demo-prices";

// The demo exchange and the demo wallet (spec step 161): made-up crypto balances, valued at
// the demo crypto prices, and the exchange's last year of buys with their fees. Read-only,
// like every crypto source: there's nothing here to place an order with. Pure.

type Position = { asset: string; quantity: number; costBasis: number };

const EXCHANGE: readonly Position[] = [
  { asset: "BTC", quantity: 0.0425, costBasis: 2_310 },
  { asset: "ETH", quantity: 1.3, costBasis: 3_020 },
  { asset: "SOL", quantity: 12, costBasis: 1_450 },
  { asset: "USDC", quantity: 150, costBasis: 150 },
];
const WALLET: readonly Position[] = [{ asset: "ETH", quantity: 0.4, costBasis: 760 }];

// A buy of Bitcoin on the 5th of every month, with the exchange's fee (about 1.49%).
export const DEMO_CRYPTO_BUY = { asset: "BTC", amount: 150, fee: 2.24, dayOfMonth: "05" };

export type DemoCryptoBalance = {
  asset: string;
  name: string;
  quantity: number;
  priceCents: number;
  valueCents: number;
  costBasisCents: number;
};

export function demoCryptoBalances(
  kind: "exchange" | "wallet",
  anchor: string,
  day: string,
): DemoCryptoBalance[] {
  return (kind === "exchange" ? EXCHANGE : WALLET).map((p) => {
    const price = demoCryptoPrice(p.asset, day, anchor) ?? 0;
    const priceCents = Math.round(price * 100);
    return {
      asset: p.asset,
      name: CRYPTO_ASSETS[p.asset] ?? p.asset,
      quantity: p.quantity,
      priceCents,
      valueCents: Math.round(p.quantity * price * 100),
      costBasisCents: Math.round(p.costBasis * 100),
    };
  });
}

export type DemoCryptoTrade = {
  date: string;
  asset: string;
  side: "buy" | "sell";
  amountCents: number;
  feeCents: number;
};

// The exchange's buys from `from` to `to` (inclusive), oldest first.
export function demoCryptoTrades(from: string, to: string): DemoCryptoTrade[] {
  const out: DemoCryptoTrade[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (day.slice(8) !== DEMO_CRYPTO_BUY.dayOfMonth) continue;
    out.push({
      date: day,
      asset: DEMO_CRYPTO_BUY.asset,
      side: "buy",
      amountCents: DEMO_CRYPTO_BUY.amount * 100,
      feeCents: Math.round(DEMO_CRYPTO_BUY.fee * 100),
    });
  }
  return out;
}
