import { LONG_TERM_DAYS, WASH_SALE_DAYS } from "@/config/tax-rates";
import { HARVEST_MIN_LOSS_CENTS, TAX_HEAVY_HOLDING } from "@/config/tax";
import { DAY_MS } from "@/lib/dates";

// Investment taxes (spec step 124). Pure. From a taxable account's holdings (with the cost
// basis the institution reports) and its buys and sells:
// - unrealised gains: each holding's value less its cost basis, so they always match the
//   holdings' basis; split short- and long-term by when its shares were bought (the shares
//   bought before the history Jane has count as long-term);
// - realised gains: each sale's proceeds less the shares' average cost (the holding's
//   basis per share), short- or long-term by first-in, first-out lots;
// - wash sales: a sale at a loss with the same security bought within 30 days either side,
//   in any account; the loss is disallowed for the replacement shares;
// - tax-loss harvesting chances, and which account to hold what in (demo advice).

export type InvHolding = {
  accountId: string;
  securityId: string;
  ticker: string | null;
  name: string;
  type: string | null;
  quantity: number;
  valueCents: number;
  costBasisCents: number | null;
};

export type InvTransaction = {
  accountId: string;
  securityId: string | null;
  date: string;
  // Plaid: buy, sell, cash, fee, transfer, cancel.
  type: string;
  subtype: string;
  // Positive for a buy, negative for a sell.
  quantity: number;
  // Plaid's sign: cash out of the account is positive (a buy), in is negative (a sale).
  amountCents: number;
};

export type Lot = { date: string | null; quantity: number };

const daysBetween = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;
const isLong = (bought: string | null, sold: string) =>
  bought === null || daysBetween(bought, sold) > LONG_TERM_DAYS;
const EPS = 1e-6;

// The shares behind a holding, oldest first: the opening shares (bought before the history,
// date unknown) then each buy, less sales first-in first-out. Returns what's left and what
// each sale took.
export function lotsFor(
  holdingQuantity: number,
  transactions: InvTransaction[],
): { left: Lot[]; sales: { date: string; quantity: number; amountCents: number; taken: Lot[] }[] } {
  const ordered = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const bought = ordered.filter((t) => t.type === "buy").reduce((s, t) => s + t.quantity, 0);
  const sold = ordered.filter((t) => t.type === "sell").reduce((s, t) => s - t.quantity, 0);
  const opening = Math.max(0, holdingQuantity + sold - bought);
  const lots: Lot[] = opening > EPS ? [{ date: null, quantity: opening }] : [];
  const sales: { date: string; quantity: number; amountCents: number; taken: Lot[] }[] = [];
  for (const t of ordered) {
    if (t.type === "buy" && t.quantity > 0) lots.push({ date: t.date, quantity: t.quantity });
    if (t.type === "sell" && t.quantity < 0) {
      let need = -t.quantity;
      const taken: Lot[] = [];
      while (need > EPS && lots.length > 0) {
        const lot = lots[0];
        const use = Math.min(lot.quantity, need);
        taken.push({ date: lot.date, quantity: use });
        lot.quantity -= use;
        need -= use;
        if (lot.quantity <= EPS) lots.shift();
      }
      if (need > EPS) taken.push({ date: null, quantity: need });
      sales.push({ date: t.date, quantity: -t.quantity, amountCents: -t.amountCents, taken });
    }
  }
  return { left: lots, sales };
}

export type Unrealised = {
  holding: InvHolding;
  gainCents: number;
  shortTermCents: number;
  longTermCents: number;
};

export function unrealised(holding: InvHolding, left: Lot[], today: string): Unrealised | null {
  if (holding.costBasisCents === null) return null;
  const gain = holding.valueCents - holding.costBasisCents;
  const total = left.reduce((s, l) => s + l.quantity, 0) || holding.quantity;
  const shortQty = left.filter((l) => !isLong(l.date, today)).reduce((s, l) => s + l.quantity, 0);
  const shortTerm = total > 0 ? Math.round((gain * shortQty) / total) : 0;
  return { holding, gainCents: gain, shortTermCents: shortTerm, longTermCents: gain - shortTerm };
}

export type Realised = {
  accountId: string;
  securityId: string;
  ticker: string | null;
  name: string;
  date: string;
  quantity: number;
  proceedsCents: number;
  costCents: number;
  gainCents: number;
  shortTermCents: number;
  longTermCents: number;
  // Disallowed by the wash-sale rule (a loss, made smaller).
  washDisallowedCents: number;
  washReplacements: { date: string; quantity: number; accountId: string }[];
};

// A loss sale's replacement purchases: the same security bought within WASH_SALE_DAYS
// either side, in any account.
export function washReplacements(
  sale: { securityId: string; date: string; accountId: string },
  allBuys: InvTransaction[],
): { date: string; quantity: number; accountId: string }[] {
  return allBuys
    .filter(
      (t) =>
        t.type === "buy" &&
        t.securityId === sale.securityId &&
        t.quantity > 0 &&
        Math.abs(daysBetween(sale.date, t.date)) <= WASH_SALE_DAYS,
    )
    .map((t) => ({ date: t.date, quantity: t.quantity, accountId: t.accountId }));
}

export function realised(
  holding: InvHolding,
  sales: ReturnType<typeof lotsFor>["sales"],
  allBuys: InvTransaction[],
): Realised[] {
  // Average cost per share, from the institution's basis for what's held.
  const perShare =
    holding.costBasisCents !== null && holding.quantity > 0
      ? holding.costBasisCents / holding.quantity
      : 0;
  return sales.map((s) => {
    const cost = Math.round(perShare * s.quantity);
    const gain = s.amountCents - cost;
    const longQty = s.taken
      .filter((l) => isLong(l.date, s.date))
      .reduce((sum, l) => sum + l.quantity, 0);
    const longTerm = Math.round((gain * longQty) / s.quantity);
    const replacements =
      gain < 0
        ? washReplacements(
            { securityId: holding.securityId, date: s.date, accountId: holding.accountId },
            allBuys,
          )
        : [];
    const replaced = replacements.reduce((sum, r) => sum + r.quantity, 0);
    const disallowed = gain < 0 ? Math.round(-gain * Math.min(1, replaced / s.quantity)) : 0;
    // The disallowed part of a loss comes off its short- and long-term parts alike.
    const allowedGain = gain + disallowed;
    const shortTerm = gain === 0 ? 0 : Math.round(((gain - longTerm) * allowedGain) / gain);
    return {
      accountId: holding.accountId,
      securityId: holding.securityId,
      ticker: holding.ticker,
      name: holding.name,
      date: s.date,
      quantity: s.quantity,
      proceedsCents: s.amountCents,
      costCents: cost,
      gainCents: allowedGain,
      shortTermCents: shortTerm,
      longTermCents: allowedGain - shortTerm,
      washDisallowedCents: disallowed,
      washReplacements: replacements,
    };
  });
}

export type HarvestChance = {
  holding: InvHolding;
  lossCents: number;
  shortTermCents: number;
  longTermCents: number;
  // Shares of it bought in the last WASH_SALE_DAYS, or reinvesting regularly: selling now
  // would be a wash sale unless that stops.
  washRisk: { boughtRecently: boolean; reinvests: boolean };
};

export function harvestChances(
  items: Unrealised[],
  buys: InvTransaction[],
  today: string,
): HarvestChance[] {
  return items
    .filter((u) => u.gainCents <= -HARVEST_MIN_LOSS_CENTS)
    .map((u) => {
      const own = buys.filter(
        (b) => b.securityId === u.holding.securityId && b.type === "buy" && b.quantity > 0,
      );
      return {
        holding: u.holding,
        lossCents: -u.gainCents,
        shortTermCents: u.shortTermCents,
        longTermCents: u.longTermCents,
        washRisk: {
          boughtRecently: own.some(
            (b) => daysBetween(b.date, today) <= WASH_SALE_DAYS && b.date <= today,
          ),
          reinvests: own.some((b) => b.subtype === "dividend reinvestment"),
        },
      };
    })
    .sort((a, b) => b.lossCents - a.lossCents);
}

// Municipal bonds' interest is already free of federal tax: fine where they are.
const TAX_EXEMPT = /\b(?:MUNI(?:CIPAL)?|TAX[- ]EXEMPT|TAX[- ]FREE)\b/i;

// Holdings in a taxable account that pay out a lot each year (bonds, income and dividend
// funds): their payouts are taxed every year there, and not in a 401(k) or IRA.
export function locationHints(holdings: InvHolding[]): InvHolding[] {
  return holdings.filter(
    (h) =>
      (h.type === "fixed income" || TAX_HEAVY_HOLDING.test(h.name)) && !TAX_EXEMPT.test(h.name),
  );
}
