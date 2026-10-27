import {
  FIXED_SECTORS,
  FLEX_SECTORS,
  YEAR_PLAN_MONTHS,
  type FixedSector,
  type FlexSector,
} from "@/config/year-plan";
import { shiftMonth } from "@/lib/dates";

// The year's money plan (spec step 205). Pure: twelve months of targets, built from the
// person's margin, what each sector wants each month and the dated amounts in the year,
// then re-planned each month from what really happened. A month that has passed is never
// changed; what was missed moves into the months still ahead.

export type Sectors = Record<FlexSector | FixedSector, number>;

export type YearMonth = {
  month: string; // YYYY-MM
  // What each sector is aiming for this month.
  targets: Sectors;
  // What really happened, for months that have passed (flexible sectors only).
  actual: Record<FlexSector, number> | null;
  // The month's margin the targets had to fit in.
  marginCents: number;
  // True when the flexible targets had to be scaled down to fit.
  trimmed: boolean;
};

export type YearInput = {
  startMonth: string;
  currentMonth: string;
  marginCents: number;
  // What each flexible sector wants a month before any catch-up.
  wants: Record<FlexSector, number>;
  // Dated amounts in the year.
  fixed: { month: string; sector: FixedSector; cents: number }[];
  // Months already planned (and kept as they were), with what happened in them.
  past: YearMonth[];
  // What happened in the months that have passed, by month.
  actuals: Record<string, Record<FlexSector, number>>;
};

const zero = (): Sectors => ({
  saving: 0,
  debt: 0,
  investing: 0,
  insurance: 0,
  taxes: 0,
  deadlines: 0,
});

// The flexible wants fitted into what's left of the month's margin, in priority order.
function fit(
  wants: Record<FlexSector, number>,
  room: number,
): { fitted: Record<FlexSector, number>; trimmed: boolean } {
  let left = Math.max(0, room);
  const fitted = { saving: 0, debt: 0, investing: 0 };
  let trimmed = false;
  for (const sector of FLEX_SECTORS) {
    const take = Math.min(wants[sector], left);
    fitted[sector] = take;
    left -= take;
    if (take < wants[sector]) trimmed = true;
  }
  return { fitted, trimmed };
}

export function yearPlan(input: YearInput): YearMonth[] {
  const months = Array.from({ length: YEAR_PLAN_MONTHS }, (_, i) =>
    shiftMonth(input.startMonth, i),
  );
  const keptByMonth = new Map(input.past.map((m) => [m.month, m]));
  const out: YearMonth[] = [];
  // What the months that passed fell short by, per flexible sector.
  const owed: Record<FlexSector, number> = { saving: 0, debt: 0, investing: 0 };

  months.forEach((month, index) => {
    if (month < input.currentMonth) {
      const kept = keptByMonth.get(month);
      const actual = input.actuals[month] ?? { saving: 0, debt: 0, investing: 0 };
      const base = kept ?? planned(month, input, zeroOwed());
      out.push({ ...base, actual });
      for (const sector of FLEX_SECTORS) {
        owed[sector] += Math.max(0, base.targets[sector] - actual[sector]);
      }
      return;
    }
    const monthsLeft = months.length - index;
    const catchUp = Object.fromEntries(
      FLEX_SECTORS.map((s) => [s, Math.round(owed[s] / monthsLeft)]),
    ) as Record<FlexSector, number>;
    // The shortfall is shared across the months left; what is taken now leaves less owed.
    const row = planned(month, input, catchUp);
    for (const sector of FLEX_SECTORS) {
      owed[sector] = Math.max(
        0,
        owed[sector] - Math.max(0, row.targets[sector] - input.wants[sector]),
      );
    }
    out.push(row);
  });
  return out;
}

const zeroOwed = (): Record<FlexSector, number> => ({ saving: 0, debt: 0, investing: 0 });

function planned(month: string, input: YearInput, catchUp: Record<FlexSector, number>): YearMonth {
  const targets = zero();
  for (const f of input.fixed) if (f.month === month) targets[f.sector] += f.cents;
  const fixedTotal = FIXED_SECTORS.reduce((s, k) => s + targets[k], 0);
  const wants = {
    saving: input.wants.saving + catchUp.saving,
    debt: input.wants.debt + catchUp.debt,
    investing: input.wants.investing + catchUp.investing,
  };
  const { fitted, trimmed } = fit(wants, input.marginCents - fixedTotal);
  targets.saving = fitted.saving;
  targets.debt = fitted.debt;
  targets.investing = fitted.investing;
  return { month, targets, actual: null, marginCents: input.marginCents, trimmed };
}

// The whole year, sector by sector. The months always add up to this.
export function yearTotals(months: YearMonth[]): Sectors {
  const totals = zero();
  for (const m of months)
    for (const k of Object.keys(totals) as (keyof Sectors)[]) totals[k] += m.targets[k];
  return totals;
}
