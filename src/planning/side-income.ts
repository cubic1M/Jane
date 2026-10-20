import { DEPRECIATION, PASSIVE_LOSS } from "@/config/side-income";

// Side income and rentals (spec step 173). Pure.
// - Depreciation: a rental building (the price less land) is written off over 27.5 years,
//   straight line, mid-month: a partial first year by the month it was rented out, the same
//   percentage after, and the rest in the last year.
// - A rental's net is rent less expenses less depreciation. A loss counts against other
//   income only up to the passive loss allowance, shrinking as income passes the phase-out;
//   the rest carries forward.
// - A hobby's income is taxed with no expenses and no self-employment tax; a business's
//   income is net of its expenses and bears self-employment tax.

export type Depreciation = {
  year: number;
  basisCents: number;
  // The building's depreciable cost.
  buildingCents: number;
  percent: number;
  cents: number;
};

// Depreciation for a tax year. placedOn is when it was ready and available to rent
// (YYYY-MM-DD); nothing before then. buildingShare is the building's share of the price.
export function rentalDepreciation(input: {
  year: number;
  priceCents: number;
  placedOn: string;
  buildingShare?: number;
}): Depreciation {
  const share = input.buildingShare ?? DEPRECIATION.buildingShare;
  const buildingCents = Math.round(input.priceCents * share);
  const placedYear = Number(input.placedOn.slice(0, 4));
  const month = Number(input.placedOn.slice(5, 7));
  let percent = 0;
  if (input.year === placedYear) percent = DEPRECIATION.firstYearByMonth[month - 1];
  else if (input.year > placedYear) {
    const elapsed = input.year - placedYear;
    // The first year's share, then perYear for each full year; the last year is what's left.
    const used = DEPRECIATION.firstYearByMonth[month - 1] + (elapsed - 1) * DEPRECIATION.perYear;
    percent = Math.max(0, Math.min(DEPRECIATION.perYear, 1 - used));
  }
  return {
    year: input.year,
    basisCents: input.priceCents,
    buildingCents,
    percent,
    cents: Math.round(buildingCents * percent),
  };
}

export type RentalNet = {
  rentCents: number;
  expensesCents: number;
  depreciationCents: number;
  // Rent less expenses less depreciation (negative: a loss).
  netCents: number;
  // What counts toward the year's income: the profit, or the part of a loss the allowance
  // lets through.
  countedCents: number;
  // The loss carried forward to later years.
  suspendedCents: number;
};

// The passive loss allowance left at this modified AGI: $25,000, less half the income
// over $100,000, nothing from $150,000.
export function lossAllowance(magiCents: number): number {
  const { allowanceCents, phaseOutFromCents, phaseOutToCents } = PASSIVE_LOSS;
  if (magiCents <= phaseOutFromCents) return allowanceCents;
  if (magiCents >= phaseOutToCents) return 0;
  return Math.max(0, allowanceCents - Math.round((magiCents - phaseOutFromCents) / 2));
}

export function rentalNet(input: {
  rentCents: number;
  expensesCents: number;
  depreciationCents: number;
  // Income before the rental, for the loss allowance.
  otherIncomeCents: number;
}): RentalNet {
  const net = input.rentCents - input.expensesCents - input.depreciationCents;
  const allowed = net < 0 ? Math.min(-net, lossAllowance(input.otherIncomeCents)) : 0;
  return {
    rentCents: input.rentCents,
    expensesCents: input.expensesCents,
    depreciationCents: input.depreciationCents,
    netCents: net,
    countedCents: net >= 0 ? net : 0 - allowed,
    suspendedCents: net < 0 ? -net - allowed : 0,
  };
}

// Hobby or business, side by side: what's taxed each way is the engine's job; here, the
// income each way. A hobby: all the income, no expenses. A business: income less expenses.
export function sideIncomeBothWays(input: { incomeCents: number; expensesCents: number }) {
  return {
    business: { incomeCents: input.incomeCents - input.expensesCents, selfEmploymentTax: true },
    hobby: { incomeCents: input.incomeCents, selfEmploymentTax: false },
  };
}

// A platform's payouts against its 1099: matched, differs or waiting for the form.
export type PlatformMatch = "matched" | "differs" | "waiting" | "unneeded";

export function matchPlatform(input: {
  payoutsCents: number;
  formCents: number | null;
  // The form's own check against the transactions (src/planning/tax-document-check.ts).
  checkStatus: "matches" | "differs" | "unchecked" | null;
  mayNotSend: boolean;
}): PlatformMatch {
  if (input.formCents === null) return input.mayNotSend ? "unneeded" : "waiting";
  return input.checkStatus === "differs" ? "differs" : "matched";
}
