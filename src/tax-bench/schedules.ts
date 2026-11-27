import type { FilingStatus } from "@/config/tax";
import type { BenchCase } from "./types";

// The 2026 Tax Rate Schedules as the IRS prints them (Publication 505 (2026), page 31): the tax at
// the start of each bracket above the first. Each row is one bench case: wages set so that taxable
// income is exactly the row's start (wages = start + the standard deduction of Rev. Proc. 2025-32
// section 4.14(1)), and the tax the schedule gives. Dollars here; the cases are built in cents.
const STANDARD: Record<FilingStatus, number> = {
  single: 16_100,
  married_joint: 32_200,
  married_separate: 16_100,
  head_of_household: 24_150,
};

// [bracket start, tax at the start], dollars.
const ROWS: Record<FilingStatus, readonly (readonly [number, number])[]> = {
  single: [
    [12_400, 1_240],
    [50_400, 5_800],
    [105_700, 17_966],
    [201_775, 41_024],
    [256_225, 58_448],
    [640_600, 192_979.25],
  ],
  head_of_household: [
    [17_700, 1_770],
    [67_450, 7_740],
    [105_700, 16_155],
    [201_750, 39_207],
    [256_200, 56_631],
    [640_600, 191_171],
  ],
  married_joint: [
    [24_800, 2_480],
    [100_800, 11_600],
    [211_400, 35_932],
    [403_550, 82_048],
    [512_450, 116_896],
    [768_700, 206_583.5],
  ],
  married_separate: [
    [12_400, 1_240],
    [50_400, 5_800],
    [105_700, 17_966],
    [201_775, 41_024],
    [256_225, 58_448],
    [384_350, 103_291.75],
  ],
};

const cents = (dollars: number) => Math.round(dollars * 100);

export function pub505ScheduleCases(): BenchCase[] {
  return (Object.keys(ROWS) as FilingStatus[]).flatMap((status) =>
    ROWS[status].map(([start, tax]): BenchCase => {
      const standard = STANDARD[status];
      return {
        id: `pub505-2026-schedule-${status}-${start}`,
        title: `2026 tax rate schedule, ${status}, taxable income $${start.toLocaleString("en-US")}`,
        taxYear: 2026,
        source: {
          kind: "irs_example",
          url: "https://www.irs.gov/pub/irs-pdf/p505.pdf",
          where: "Publication 505 (2026), page 31, 2026 Tax Rate Schedules X, Y-1, Y-2 and Z",
        },
        household: { filingStatus: status, childrenUnder17: 0, otherDependants: 0, state: null },
        income: { wagesCents: cents(start + standard) },
        expected: {
          standardDeduction: cents(standard),
          taxable: cents(start),
          incomeTax: cents(tax),
        },
      };
    }),
  );
}
