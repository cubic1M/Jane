import { LONG_VIEW_HORIZONS, ROLL_FREED_PAYMENTS } from "@/config/long-view";

// The long view (spec step 209). Pure: the person's balances, debts and monthly margin in,
// net worth at 10, 20 and 30 years out as a range, in today's dollars, with what moves it
// most. All growth rates are real (after inflation) and handed in, so the page can show
// and edit them. A range from the low to the high return, never a promise.

export type LongViewDebt = {
  name: string;
  balanceCents: number;
  aprBps: number;
  // Paid each month; null if unknown (the balance then just stays).
  paymentCents: number | null;
  // A card's payment comes out of the month's margin; others are in spending already.
  fromMargin: boolean;
};

export type LongViewInput = {
  cashCents: number;
  investedCents: number;
  // Things owned that grow (a home) and things held at today's value (a car).
  growingAssetsCents: number;
  otherAssetsCents: number;
  debts: LongViewDebt[];
  // Income less spending, a month.
  marginCents: number;
  // Of what is saved each month, how much goes into investments (the rest stays in cash).
  investMonthlyCents: number;
};

export type Rates = {
  // Real yearly growth.
  investedLow: number;
  investedHigh: number;
  cash: number;
  home: number;
};

export type Horizon = {
  years: number;
  lowCents: number;
  highCents: number;
  parts: {
    cashCents: number;
    investedLowCents: number;
    investedHighCents: number;
    homeCents: number;
    otherCents: number;
    debtsCents: number;
  };
};

const monthly = (yearly: number) => Math.pow(1 + yearly, 1 / 12) - 1;
const BPS = 10_000;
const MONTHS = 12;

// One run of the longest horizon's months at an invested-return rate; the balances at each
// horizon. Each month: balances grow; each debt takes its payment (interest first); what
// is saved is the margin less the card payments still being made, plus the payments of
// non-card debts already paid off (spending no longer holds them). Of that, up to the
// monthly investing (and, once a debt is paid off, its old payment) goes to investments,
// and the rest to cash.
function run(input: LongViewInput, rates: Rates, investedRate: number, extraInvest = 0) {
  const r = monthly(investedRate);
  const rc = monthly(rates.cash);
  const rh = monthly(rates.home);
  let cash = input.cashCents;
  let invested = input.investedCents;
  let home = input.growingAssetsCents;
  const debts = input.debts.map((d) => ({ ...d, balance: d.balanceCents }));
  const horizons: readonly number[] = LONG_VIEW_HORIZONS;
  const last = Math.max(...horizons) * MONTHS;
  const out = new Map<number, { cash: number; invested: number; home: number; debts: number }>();

  for (let month = 1; month <= last; month += 1) {
    cash *= 1 + rc;
    invested *= 1 + r;
    home *= 1 + rh;
    let cardPayments = 0;
    let paidOff = 0;
    let paidOffOutsideMargin = 0;
    for (const d of debts) {
      if (d.balance <= 0) {
        paidOff += d.paymentCents ?? 0;
        if (!d.fromMargin) paidOffOutsideMargin += d.paymentCents ?? 0;
        continue;
      }
      const interest = d.balance * (d.aprBps / BPS / MONTHS);
      const pay = Math.min(d.balance + interest, d.paymentCents ?? 0);
      d.balance = Math.max(0, d.balance + interest - pay);
      if (d.fromMargin) cardPayments += pay;
    }
    const saved = Math.max(0, input.marginCents - cardPayments + paidOffOutsideMargin);
    const toInvest = Math.min(
      saved,
      input.investMonthlyCents + (ROLL_FREED_PAYMENTS ? paidOff : 0),
    );
    // An extra amount the person chose to invest is moved from cash whatever the margin.
    invested += toInvest + extraInvest;
    cash += saved - toInvest - extraInvest;
    if (month % MONTHS === 0 && horizons.includes(month / MONTHS)) {
      out.set(month / MONTHS, {
        cash,
        invested,
        home,
        debts: debts.reduce((sum, d) => sum + d.balance, 0),
      });
    }
  }
  return out;
}

export function longView(input: LongViewInput, rates: Rates, extraInvest = 0): Horizon[] {
  const low = run(input, rates, rates.investedLow, extraInvest);
  const high = run(input, rates, rates.investedHigh, extraInvest);
  return LONG_VIEW_HORIZONS.map((years) => {
    const l = low.get(years)!;
    const h = high.get(years)!;
    const other = input.otherAssetsCents;
    const lowNet = l.cash + l.invested + l.home + other - l.debts;
    const highNet = h.cash + h.invested + h.home + other - h.debts;
    return {
      years,
      lowCents: Math.round(lowNet),
      highCents: Math.round(highNet),
      parts: {
        cashCents: Math.max(0, Math.round(l.cash)),
        investedLowCents: Math.round(l.invested),
        investedHighCents: Math.round(h.invested),
        homeCents: Math.round(l.home),
        otherCents: other,
        debtsCents: Math.round(l.debts),
      },
    };
  });
}

export type Lever = { key: string; label: string; deltaCents: number };

// What moves the 30-year low end most: a little more invested each month, or the same
// amount taken off the debts (as a lower balance, by raising their payments).
export function levers(input: LongViewInput, rates: Rates, monthlyCents: number): Lever[] {
  const base = longView(input, rates).at(-1)!.lowCents;
  const more = longView(input, rates, monthlyCents).at(-1)!.lowCents;
  const out: Lever[] = [{ key: "invest", label: "invest", deltaCents: more - base }];
  const target = [...input.debts]
    .filter((d) => d.balanceCents > 0 && d.paymentCents)
    .sort((a, b) => b.aprBps - a.aprBps)[0];
  if (target) {
    const faster = {
      ...input,
      debts: input.debts.map((d) =>
        d === target ? { ...d, paymentCents: (d.paymentCents ?? 0) + monthlyCents } : d,
      ),
    };
    out.push({
      key: `debt:${target.name}`,
      label: target.name,
      deltaCents: longView(faster, rates).at(-1)!.lowCents - base,
    });
  }
  return out.sort((a, b) => b.deltaCents - a.deltaCents);
}
