import {
  APPLICABLE_PERCENT,
  HSA_EXCESS_EXCISE,
  MEDICAL_FLOOR,
  PTC_CLIFF,
  REPAYMENT_CAPS,
  fplFor,
} from "@/config/health-taxes";

// The tax side of health insurance (spec step 269). Pure: the premium tax credit a household is
// allowed at its real income against the advance payments it took (repayment risk, caught
// mid-year), contributions to an HSA over the limit, and the medical deduction's floor.

const round = Math.round;

// Share of income expected toward the benchmark plan, by share of the poverty line.
export function applicablePercent(fplShare: number): number {
  const pts = APPLICABLE_PERCENT;
  if (fplShare <= pts[0].fpl) return pts[0].pct;
  for (let i = 1; i < pts.length; i++) {
    if (fplShare <= pts[i].fpl) {
      const a = pts[i - 1];
      const b = pts[i];
      return a.pct + ((b.pct - a.pct) * (fplShare - a.fpl)) / (b.fpl - a.fpl);
    }
  }
  return pts[pts.length - 1].pct;
}

export type PtcCheck = {
  fplShare: number;
  overCliff: boolean;
  // The credit allowed at this income for the year.
  allowedCents: number;
  // The advance credit paid for the year.
  advanceCents: number;
  // What would have to be paid back with the return (0 if the credit was too small: the rest
  // is a refund at filing).
  repayCents: number;
  // The limit on repayment, null over the cliff (all of it is repaid).
  capCents: number | null;
};

export function ptcCheck(input: {
  // Projected adjusted income for the year (modified AGI), cents.
  incomeCents: number;
  householdSize: number;
  // The benchmark plan's premium for the year, and the advance credit paid, in cents.
  benchmarkYearCents: number;
  advanceYearCents: number;
}): PtcCheck {
  const share = input.incomeCents / fplFor(input.householdSize);
  const overCliff = share > PTC_CLIFF;
  const allowed = overCliff
    ? 0
    : Math.max(0, input.benchmarkYearCents - round(input.incomeCents * applicablePercent(share)));
  const excess = Math.max(0, input.advanceYearCents - allowed);
  const cap = overCliff
    ? null
    : (() => {
        const row = REPAYMENT_CAPS.find((c) => share < c.under);
        if (!row) return null;
        return input.householdSize <= 1 ? row.single : row.other;
      })();
  return {
    fplShare: share,
    overCliff,
    allowedCents: allowed,
    advanceCents: input.advanceYearCents,
    repayCents: cap === null ? excess : Math.min(excess, cap),
    capCents: cap,
  };
}

// Contributions to HSAs over the year's limit are taxed as income and carry a 6% excise tax each
// year they stay in: take them out (with earnings) before the filing deadline to avoid the excise.
export function hsaExcess(input: {
  contributedCents: number;
  limitCents: number;
  marginalRate: number;
}) {
  const excess = Math.max(0, input.contributedCents - input.limitCents);
  return {
    excessCents: excess,
    exciseCents: round(excess * HSA_EXCESS_EXCISE),
    taxCents: round(excess * input.marginalRate),
  };
}

// The part of medical costs that counts: over 7.5% of adjusted gross income.
export function medicalDeduction(input: { medicalCents: number; agiCents: number }) {
  const floor = round(input.agiCents * MEDICAL_FLOOR);
  return { floorCents: floor, deductibleCents: Math.max(0, input.medicalCents - floor) };
}
