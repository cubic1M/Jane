import { CRYPTO_TAX } from "@/config/equity-tax";
import { DAY_MS } from "@/lib/dates";

// Crypto gains and losses (spec step 219). Pure. Crypto is property: a sale is a gain or loss
// on the lots sold, first in, first out (a lot is one buy: when, how many coins, what it
// cost with its fee). Held more than a year it's long-term. The coins held from before the
// history Jane has are one opening lot at the cost basis the exchange reports, long-term.

export type Trade = {
  date: string;
  asset: string;
  side: "buy" | "sell";
  quantity: number;
  // What was paid, or what was received, in cents, with the fee: a buy's cost includes its
  // fee; a sale's proceeds are net of it.
  cents: number;
};

export type CryptoLot = { date: string | null; quantity: number; costCents: number };

export type Sale = {
  asset: string;
  date: string;
  quantity: number;
  proceedsCents: number;
  costCents: number;
  gainCents: number;
  shortTermCents: number;
  longTermCents: number;
};

const days = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;
const isLong = (bought: string | null, sold: string) =>
  bought === null || days(bought, sold) > CRYPTO_TAX.longTermDays;
const EPS = 1e-9;

// The lots left and the sales, per asset, from its trades (oldest first) and what's held
// now. holdingQuantity less what the trades add up to is the opening lot, at
// openingCostCents.
export function lotsAndSales(
  asset: string,
  trades: Trade[],
  holdingQuantity: number,
  openingCostCents: number | null,
): { left: CryptoLot[]; sales: Sale[] } {
  const mine = trades.filter((t) => t.asset === asset).sort((a, b) => a.date.localeCompare(b.date));
  const bought = mine.filter((t) => t.side === "buy").reduce((s, t) => s + t.quantity, 0);
  const sold = mine.filter((t) => t.side === "sell").reduce((s, t) => s + t.quantity, 0);
  const opening = Math.max(0, holdingQuantity + sold - bought);
  const lots: CryptoLot[] = [];
  if (opening > EPS) {
    // The basis the exchange reports covers what's held now, so the opening part of it is
    // the basis less what the buys in the history account for.
    const boughtCost = mine.filter((t) => t.side === "buy").reduce((s, t) => s + t.cents, 0);
    const heldNowFromBuys = Math.max(0, bought - sold);
    const basisForBuys =
      heldNowFromBuys > 0 && bought > 0 ? (boughtCost * heldNowFromBuys) / bought : 0;
    lots.push({
      date: null,
      quantity: opening,
      costCents: Math.max(0, Math.round((openingCostCents ?? 0) - basisForBuys)),
    });
  }
  const sales: Sale[] = [];
  for (const t of mine) {
    if (t.side === "buy") {
      lots.push({ date: t.date, quantity: t.quantity, costCents: t.cents });
      continue;
    }
    let need = t.quantity;
    let cost = 0;
    let longCost = 0;
    let longQty = 0;
    while (need > EPS && lots.length > 0) {
      const lot = lots[0];
      const use = Math.min(lot.quantity, need);
      const part = lot.quantity > 0 ? (lot.costCents * use) / lot.quantity : 0;
      cost += part;
      if (isLong(lot.date, t.date)) {
        longCost += part;
        longQty += use;
      }
      lot.costCents -= part;
      lot.quantity -= use;
      need -= use;
      if (lot.quantity <= EPS) lots.shift();
    }
    const gain = t.cents - cost;
    const longProceeds = t.quantity > 0 ? (t.cents * longQty) / t.quantity : 0;
    const longGain = longProceeds - longCost;
    sales.push({
      asset,
      date: t.date,
      quantity: t.quantity,
      proceedsCents: t.cents,
      costCents: Math.round(cost),
      gainCents: Math.round(gain),
      longTermCents: Math.round(longGain),
      shortTermCents: Math.round(gain) - Math.round(longGain),
    });
  }
  return { left: lots, sales };
}

// A holding's unrealised gain split by the lots left: value less basis, the short-term part
// by the share of coins in lots held a year or less.
export function unrealised(valueCents: number, left: CryptoLot[], today: string) {
  const basis = left.reduce((s, l) => s + l.costCents, 0);
  const total = left.reduce((s, l) => s + l.quantity, 0);
  const shortQty = left.filter((l) => !isLong(l.date, today)).reduce((s, l) => s + l.quantity, 0);
  const gain = valueCents - Math.round(basis);
  const shortTerm = total > 0 ? Math.round((gain * shortQty) / total) : 0;
  return {
    gainCents: gain,
    shortTermCents: shortTerm,
    longTermCents: gain - shortTerm,
    basisCents: Math.round(basis),
  };
}

// Sales in a tax year.
export const salesIn = (sales: Sale[], year: number) =>
  sales.filter((s) => s.date.startsWith(String(year)));
export const totals = (sales: Sale[]) => ({
  proceedsCents: sales.reduce((s, x) => s + x.proceedsCents, 0),
  costCents: sales.reduce((s, x) => s + x.costCents, 0),
  shortTermCents: sales.reduce((s, x) => s + x.shortTermCents, 0),
  longTermCents: sales.reduce((s, x) => s + x.longTermCents, 0),
});
