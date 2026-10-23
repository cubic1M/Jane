import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "./spending";
import {
  oneOffCharges,
  oneOffNote,
  typicalMonthlySpending,
  typicalOf,
  withoutOneOffs,
} from "./typical-month";

// Books QA: the Reyes' September flood repairs ($36,200 across three contractors) made every
// monthly spending figure about $14,900 instead of about $8,600. One-offs are left out of the
// typical month; bills, however rarely they come, never are.

const t = (o: Partial<InsightTransaction>): InsightTransaction => ({
  date: "2026-05-05",
  amountCents: 10_000,
  description: "GROCER",
  merchantName: "Grocer",
  pfcPrimary: "FOOD_AND_DRINK",
  pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
  pending: false,
  ...o,
});

const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
// $8,000 of everyday spending every month.
const everyday = MONTHS.map((m) => t({ date: `${m}-10`, amountCents: 800_000 }));
const repair = (date: string, merchant: string, cents: number) =>
  t({
    date,
    amountCents: cents,
    description: merchant.toUpperCase(),
    merchantName: merchant,
    pfcPrimary: "HOME_IMPROVEMENT",
    pfcDetailed: "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE",
  });
const flood = [
  repair("2026-09-12", "Gulf Coast Contractors", 1_180_000),
  repair("2026-09-20", "Servpro", 340_000),
  repair("2026-09-28", "Bayou Flooring", 2_100_000),
];
const ASOF = "2026-10-15";

describe("oneOffCharges", () => {
  it("finds the flood repairs and nothing else", () => {
    expect(oneOffCharges([...everyday, ...flood], ASOF).map((o) => o.merchant)).toEqual([
      "Gulf Coast Contractors",
      "Servpro",
      "Bayou Flooring",
    ]);
  });

  it("never counts a bill as a one-off, however rarely it comes", () => {
    const bills = [
      t({
        date: "2026-06-01",
        amountCents: 290_000,
        merchantName: "Harris County Tax",
        pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
      }),
      t({
        date: "2026-07-01",
        amountCents: 240_000,
        merchantName: "Geico",
        pfcPrimary: "GENERAL_SERVICES",
        pfcDetailed: "GENERAL_SERVICES_INSURANCE",
      }),
      t({
        date: "2026-08-20",
        amountCents: 450_000,
        merchantName: "State University",
        pfcPrimary: "GENERAL_SERVICES",
        pfcDetailed: "GENERAL_SERVICES_EDUCATION",
      }),
    ];
    expect(oneOffCharges([...everyday, ...bills], ASOF)).toEqual([]);
  });

  it("keeps a merchant charged that much again, and small charges", () => {
    const twice = [
      repair("2026-05-02", "Lawn Pros", 300_000),
      repair("2026-08-02", "Lawn Pros", 250_000),
    ];
    const small = repair("2026-07-02", "Hardware Store", 90_000);
    expect(oneOffCharges([...everyday, ...twice, small], ASOF)).toEqual([]);
  });

  it("scales with the person: a quarter of a usual month, at least $1,000", () => {
    const big = MONTHS.map((m) => t({ date: `${m}-10`, amountCents: 2_000_000 }));
    // $3,400 is a one-off for someone spending $8,000 a month, not for someone spending $20,000.
    const servpro = repair("2026-09-20", "Servpro", 340_000);
    expect(oneOffCharges([...everyday, servpro], ASOF)).toHaveLength(1);
    expect(oneOffCharges([...big, servpro], ASOF)).toEqual([]);
  });
});

describe("a short history", () => {
  it("finds nothing (and doesn't fail) when everything is in this month", () => {
    expect(
      oneOffCharges([t({ date: "2026-10-02" }), repair("2026-10-05", "Servpro", 340_000)], ASOF),
    ).toEqual([]);
    expect(oneOffCharges([], ASOF)).toEqual([]);
  });
});

describe("the typical month", () => {
  it("leaves the one-offs out of the average, and says so", () => {
    const all = [...everyday, ...flood];
    expect(typicalMonthlySpending(all, ASOF, 3)).toBe(800_000);
    expect(typicalOf(all, ASOF)).toEqual(everyday);
    expect(withoutOneOffs(all, [])).toBe(all);
    expect(oneOffNote(oneOffCharges(all, ASOF))).toBe(
      "September was unusual: $36,200.00 of one-off costs (Gulf Coast Contractors $11,800.00, Servpro $3,400.00, Bayou Flooring $21,000.00) are left out, so this is a typical month.",
    );
    expect(oneOffNote(oneOffCharges(all, ASOF), ["2026-08"])).toBeNull();
  });
});
