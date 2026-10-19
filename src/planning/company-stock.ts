import {
  COMPANY_DROP,
  DIVERSIFY_MONTHS_APART,
  DIVERSIFY_PARTS,
  EMPLOYER_STOCK_LIMIT,
  MIN_PART_CENTS,
} from "@/config/company-stock";
import { LONG_TERM_DAYS } from "@/config/tax-rates";
import type { Lot } from "./investment-taxes";

// Company stock (spec step 160, demo advice). Pure. How much of what the person has
// invested is in their employer's stock (and how much more is coming as unvested shares),
// and a plan to sell down to the limit in parts, oldest shares first (long-term, taxed
// less), each with its estimated tax and the risk it removes. Nothing is sold by the plan:
// each part is a tap.

export type Concentration = {
  heldCents: number;
  unvestedCents: number;
  totalInvestedCents: number;
  share: number;
  // Counting the shares still to vest as if they were here.
  shareWithUnvested: number;
  overLimit: boolean;
};

export function concentration(input: {
  heldCents: number;
  unvestedCents: number;
  totalInvestedCents: number;
}): Concentration {
  const share = input.totalInvestedCents > 0 ? input.heldCents / input.totalInvestedCents : 0;
  const withUnvested =
    input.totalInvestedCents + input.unvestedCents > 0
      ? (input.heldCents + input.unvestedCents) / (input.totalInvestedCents + input.unvestedCents)
      : 0;
  return {
    ...input,
    share,
    shareWithUnvested: withUnvested,
    overLimit: share > EMPLOYER_STOCK_LIMIT,
  };
}

export type Part = {
  index: number;
  // YYYY-MM-DD: when this part is due (the first is now).
  on: string;
  shares: number;
  proceedsCents: number;
  gainCents: number;
  longTermCents: number;
  shortTermCents: number;
  taxCents: number;
};

export type DiversifyPlan = {
  parts: Part[];
  sellCents: number;
  taxCents: number;
  // Share of savings in the company, now and after the plan.
  shareBefore: number;
  shareAfter: number;
  // What a COMPANY_DROP fall in the company would cost, before and after.
  dropBeforeCents: number;
  dropAfterCents: number;
};

const DAY_MS = 86_400_000;
const addMonths = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const isLong = (bought: string | null, sold: string) =>
  bought === null || (Date.parse(sold) - Date.parse(bought)) / DAY_MS > LONG_TERM_DAYS;

export function diversifyPlan(input: {
  // The employer shares held in taxable accounts: how many, the price, the cost basis.
  quantity: number;
  priceCents: number;
  costBasisCents: number;
  // Their lots, oldest first (step 124's lotsFor).
  lots: Lot[];
  totalInvestedCents: number;
  today: string;
  rates: { longTerm: number; shortTerm: number };
  // The employer's stock held elsewhere, which counts towards the limit too.
  otherCents?: number;
}): DiversifyPlan {
  const other = input.otherCents ?? 0;
  const here = Math.round(input.quantity * input.priceCents);
  const value = here + other;
  const target = Math.round(input.totalInvestedCents * EMPLOYER_STOCK_LIMIT);
  // Sold from this holding only, down to the limit counting the rest.
  const sellCents = Math.min(here, Math.max(0, value - target));
  const shareBefore = input.totalInvestedCents > 0 ? value / input.totalInvestedCents : 0;
  const empty: DiversifyPlan = {
    parts: [],
    sellCents: 0,
    taxCents: 0,
    shareBefore,
    shareAfter: shareBefore,
    dropBeforeCents: Math.round(value * COMPANY_DROP),
    dropAfterCents: Math.round(value * COMPANY_DROP),
  };
  if (sellCents < MIN_PART_CENTS || input.priceCents <= 0 || input.quantity <= 0) return empty;
  const basisPerShare = input.costBasisCents / input.quantity;
  const sharesToSell = sellCents / input.priceCents;
  const count = Math.max(1, Math.min(DIVERSIFY_PARTS, Math.floor(sellCents / MIN_PART_CENTS)));
  const perPart = sharesToSell / count;
  // Oldest lots first: the long-term ones are taxed less.
  const lots = input.lots.map((l) => ({ ...l }));
  const parts: Part[] = [];
  for (let i = 0; i < count; i += 1) {
    const on = addMonths(input.today, i * DIVERSIFY_MONTHS_APART);
    let need = perPart;
    let longQty = 0;
    let shortQty = 0;
    while (need > 1e-9 && lots.length > 0) {
      const lot = lots[0];
      const use = Math.min(lot.quantity, need);
      if (isLong(lot.date, on)) longQty += use;
      else shortQty += use;
      lot.quantity -= use;
      need -= use;
      if (lot.quantity <= 1e-9) lots.shift();
    }
    // Shares without a known lot count as long-term (held before the history).
    longQty += need;
    const gainPerShare = input.priceCents - basisPerShare;
    const longTermCents = Math.round(longQty * gainPerShare);
    const shortTermCents = Math.round(shortQty * gainPerShare);
    const taxCents = Math.max(
      0,
      Math.round(
        Math.max(0, longTermCents) * input.rates.longTerm +
          Math.max(0, shortTermCents) * input.rates.shortTerm,
      ),
    );
    parts.push({
      index: i,
      on,
      shares: Number(perPart.toFixed(4)),
      proceedsCents: Math.round(perPart * input.priceCents),
      gainCents: longTermCents + shortTermCents,
      longTermCents,
      shortTermCents,
      taxCents,
    });
  }
  const after = value - sellCents;
  return {
    parts,
    sellCents,
    taxCents: parts.reduce((s, p) => s + p.taxCents, 0),
    shareBefore,
    shareAfter: input.totalInvestedCents > 0 ? after / input.totalInvestedCents : 0,
    dropBeforeCents: Math.round(value * COMPANY_DROP),
    dropAfterCents: Math.round(after * COMPANY_DROP),
  };
}
