import { demoCryptoBalances, demoCryptoTrades } from "@/data-sources/demo/demo-crypto";

// Where crypto balances come from (spec step 161): an exchange account or a public wallet
// address, read-only. An interface, so a crypto data partner can be connected later; until
// then the demo source below stands in for demo-bank people. By design it has no way to
// place an order, move coins or hold keys: Jane never trades crypto.

export type CryptoConnectionRef = {
  kind: "exchange" | "wallet";
  partner: string;
  address: string | null;
};

export type CryptoBalance = {
  asset: string;
  name: string;
  quantity: number;
  priceCents: number;
  valueCents: number;
  costBasisCents: number | null;
};

export type CryptoTrade = {
  date: string;
  asset: string;
  side: "buy" | "sell";
  amountCents: number;
  feeCents: number;
};

export interface CryptoSource {
  readonly name: string;
  // Always true: a crypto source only reads.
  readonly readOnly: true;
  balances(connection: CryptoConnectionRef, today: string): Promise<CryptoBalance[]>;
  // Exchanges only: the trades between two days, with their fees. A wallet has none.
  trades(connection: CryptoConnectionRef, from: string, to: string): Promise<CryptoTrade[]>;
}

export const DEMO_CRYPTO_PARTNER = "demo";
export const DEMO_EXCHANGE_NAME = "Demo Exchange";
export const DEMO_WALLET_NAME = "Demo Wallet";
export const DEMO_WALLET_ADDRESS = "0xDEMO0000000000000000000000000000000000D3";

// The demo source, valued at the demo crypto prices from the day the demo bank was linked.
export function demoCryptoSource(anchor: string): CryptoSource {
  return {
    name: "Demo crypto source (sample data, not a real exchange)",
    readOnly: true,
    async balances(connection, today) {
      return demoCryptoBalances(connection.kind, anchor, today);
    },
    async trades(connection, from, to) {
      return connection.kind === "exchange" ? demoCryptoTrades(from, to) : [];
    },
  };
}
