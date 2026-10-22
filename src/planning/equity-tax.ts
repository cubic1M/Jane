import { DETECTOR_RATES } from "@/config/detectors";
import { AMT, EQUITY_SET_ASIDE_MIN_CENTS, ESPP_RULES, RSU_WITHHOLDING } from "@/config/equity-tax";
import type { FilingStatus } from "@/config/tax";

// Equity pay, taxed right (spec step 219). Pure.
// - ESPP: a sale is a qualifying disposition only more than 2 years after the offering date
//   AND more than 1 year after the purchase. Otherwise it's disqualifying: the discount is
//   ordinary income (which the employer may not have put on the W-2), and only the rest is
//   a capital gain. Jane says what the special treatment would have been worth.
// - ISO: exercising and holding past year-end counts the spread as an alternative minimum
//   tax (AMT) preference; selling in the year of exercise is ordinary income instead.
// - RSU: the vest is wages at the market price, but the employer withholds a flat 22%: if
//   the person's real rate is higher, the difference is a bill at filing.

export type Event = {
  kind: "rsu" | "espp" | "iso";
  company: string;
  shares: number;
  // The day shares vested, were bought or were exercised.
  occurredOn: string;
  // ESPP offering date or ISO grant date, when known.
  grantedOn: string | null;
  // Per share, in cents: the price paid (ESPP, ISO strike); 0 for RSUs.
  priceCents: number;
  // The market price per share on occurredOn.
  fmvCents: number;
  // Tax withheld on an RSU vest, if the person knows.
  withheldCents: number | null;
  soldOn: string | null;
  soldPriceCents: number | null;
  // ESPP: the discount per share at the offering date, in cents, if known.
  grantDiscountCents?: number | null;
};

const addYears = (date: string, years: number) =>
  `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
const cents = (n: number) => Math.round(n);

export type EsppResult = {
  qualifying: boolean;
  // Ordinary income and capital gain from the sale.
  ordinaryCents: number;
  gainCents: number;
  longTerm: boolean;
  // How much more of it is ordinary income than a qualifying sale would have made.
  lostTreatmentCents: number;
};

export function esppSale(e: Event): EsppResult | null {
  if (e.kind !== "espp" || !e.soldOn || e.soldPriceCents === null) return null;
  const spread = (e.fmvCents - e.priceCents) * e.shares;
  const total = (e.soldPriceCents - e.priceCents) * e.shares;
  const qualifying =
    (e.grantedOn === null || e.soldOn > addYears(e.grantedOn, ESPP_RULES.yearsAfterGrant)) &&
    e.soldOn > addYears(e.occurredOn, ESPP_RULES.yearsAfterPurchase);
  // What a qualifying sale makes ordinary income: the lesser of the discount at the
  // offering (when known; else the spread at purchase) and the whole gain. The rest is a
  // long-term gain.
  const discount = e.grantDiscountCents != null ? e.grantDiscountCents * e.shares : spread;
  const qualifyingOrdinary = Math.max(0, Math.min(discount, total));
  if (qualifying) {
    return {
      qualifying,
      ordinaryCents: cents(qualifyingOrdinary),
      gainCents: cents(total - qualifyingOrdinary),
      longTerm: true,
      lostTreatmentCents: 0,
    };
  }
  // Disqualifying: the whole spread at purchase is ordinary income, even if the shares were
  // then sold for less; the capital gain or loss is measured from the market price at
  // purchase.
  const ordinary = Math.max(0, spread);
  return {
    qualifying,
    ordinaryCents: cents(ordinary),
    gainCents: cents((e.soldPriceCents - e.fmvCents) * e.shares),
    longTerm: e.soldOn > addYears(e.occurredOn, 1),
    lostTreatmentCents: cents(Math.max(0, ordinary - qualifyingOrdinary)),
  };
}

export type IsoResult = {
  // The AMT preference: the spread at exercise, when the shares are held past year-end.
  preferenceCents: number;
  // Sold in the year of exercise: ordinary income instead.
  ordinaryCents: number;
  gainCents: number;
};

export function isoExercise(e: Event, year: number): IsoResult | null {
  if (e.kind !== "iso" || !e.occurredOn.startsWith(String(year))) return null;
  const spread = cents((e.fmvCents - e.priceCents) * e.shares);
  const soldSameYear =
    e.soldOn !== null && e.soldOn.startsWith(String(year)) && e.soldPriceCents !== null;
  if (soldSameYear) {
    const total = (e.soldPriceCents! - e.priceCents) * e.shares;
    const ordinary = Math.max(0, Math.min(spread, total));
    return {
      preferenceCents: 0,
      ordinaryCents: cents(ordinary),
      gainCents: cents(total - ordinary),
    };
  }
  return { preferenceCents: Math.max(0, spread), ordinaryCents: 0, gainCents: 0 };
}

export type RsuResult = {
  incomeCents: number;
  withheldCents: number;
  // Withheld at the flat rate unless the person said what was.
  rateWithheld: number;
  // The extra tax owed at the person's real rate.
  shortfallCents: number;
};

export function rsuVest(
  e: Event,
  marginalRate: number,
  supplementalSoFarCents = 0,
): RsuResult | null {
  if (e.kind !== "rsu" || e.shares <= 0) return null;
  const income = cents(e.shares * e.fmvCents);
  // The flat rate; 37% on the part of the year's supplemental wages over $1 million.
  const overCents = Math.max(0, supplementalSoFarCents + income - RSU_WITHHOLDING.highFromCents);
  const high = Math.min(income, overCents);
  const flat = cents((income - high) * RSU_WITHHOLDING.flatRate + high * RSU_WITHHOLDING.highRate);
  const withheld = e.withheldCents ?? flat;
  const real = cents(income * marginalRate);
  return {
    incomeCents: income,
    withheldCents: withheld,
    rateWithheld: income > 0 ? withheld / income : 0,
    shortfallCents: Math.max(0, real - withheld),
  };
}

// The alternative minimum tax on top of the regular tax (Form 6251, simplified). AMT income
// is taxable income plus the standard deduction (or the state and local taxes deducted,
// neither of which AMT allows) plus the preference. The exemption shrinks by 25 cents for
// each dollar over the phase-out start; tax is 26% to the threshold and 28% above.
export function amt(input: {
  status: FilingStatus;
  taxableCents: number;
  addBackCents: number;
  preferenceCents: number;
  regularTaxCents: number;
}): { amtCents: number; amtIncomeCents: number; tentativeCents: number } {
  const amtIncome = Math.max(0, input.taxableCents + input.addBackCents + input.preferenceCents);
  const exemption = Math.max(
    0,
    AMT.exemption[input.status] -
      Math.round(Math.max(0, amtIncome - AMT.phaseOutStart[input.status]) * AMT.phaseOutRate),
  );
  const base = Math.max(0, amtIncome - exemption);
  const high = Math.max(0, base - AMT.highRateFrom[input.status]);
  const tentative = Math.round((base - high) * AMT.lowRate + high * AMT.highRate);
  return {
    amtCents: Math.max(0, tentative - input.regularTaxCents),
    amtIncomeCents: amtIncome,
    tentativeCents: tentative,
  };
}

// Whether a set-aside is worth offering for the tax on an event.
export const worthSettingAside = (taxCents: number) => taxCents >= EQUITY_SET_ASIDE_MIN_CENTS;

// With no vest schedule known: an assumed share of the stock plan vests this year, withheld at
// the flat rate, and what is short at the person's rate. The brief's suggestion and the chat's
// answer both use this, and say it is assumed.
export function assumedRsuGap(stockCents: number, marginalRate: number) {
  const vestedCents = Math.round(stockCents * DETECTOR_RATES.tax.stockVestShare);
  const shortfallCents = Math.max(
    0,
    Math.round(vestedCents * (marginalRate - RSU_WITHHOLDING.flatRate)),
  );
  return { vestedCents, shortfallCents };
}
