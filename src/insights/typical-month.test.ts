import { describe, expect, it } from "vitest";
import type { InsightTransaction } from "./spending";
import {
  oneOffCharges,
  oneOffNote,
  typicalMonthlySpending,
  rareBills,
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

// Debugger 11-02: a $62,000 wire to a title company had no category, so it couldn't be a one-off: it
// went into the typical month, and someone with $42,333 in cash read "a cushion for you is $79,683".
describe("a very large charge with no category", () => {
  const wire = t({
    date: "2026-08-18",
    amountCents: 6_200_000,
    description: "WIRE OUT CHICAGO TITLE ESCROW",
    merchantName: "Wire Out Chicago Title Escrow",
    pfcPrimary: null,
    pfcDetailed: null,
  });

  it("is a one-off", () => {
    const found = oneOffCharges([...everyday, wire], "2026-10-15");
    expect(found.map((o) => o.amountCents)).toEqual([6_200_000]);
  });

  it("isn't one when it comes back", () => {
    const again = { ...wire, date: "2026-09-18" };
    expect(oneOffCharges([...everyday, wire, again], "2026-10-15")).toEqual([]);
  });

  it("leaves rent by check in the typical month, with a new name each time", () => {
    const checks = MONTHS.map((m, i) =>
      t({
        date: `${m}-01`,
        amountCents: 250_000,
        description: `CHECK 104${i}`,
        merchantName: `Check 104${i}`,
        pfcPrimary: null,
        pfcDetailed: null,
      }),
    );
    expect(oneOffCharges([...everyday, ...checks], "2026-10-15")).toEqual([]);
  });

  it("isn't one at the size of an ordinary month", () => {
    const small = { ...wire, amountCents: 800_000 };
    expect(oneOffCharges([...everyday, small], "2026-10-15")).toEqual([]);
  });
});

// Debugger 11-03: a student's $4,815 of tuition in August read as $2,739 of monthly spending, on
// months of about $1,011. A bill isn't a one-off, it's a real cost, but one that comes twice a year
// doesn't cost that much every month: it counts across the months, not in the one it landed in.
describe("a big bill that comes a few times a year", () => {
  const MONTHS_7 = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const month = MONTHS_7.map((m) =>
    t({ date: `${m}-03`, amountCents: 100_000, merchantName: "Campus Edge Apts" }),
  );
  const tuition = t({
    date: "2026-08-24",
    amountCents: 481_500,
    merchantName: "University Bursar",
    pfcPrimary: "GENERAL_SERVICES",
    pfcDetailed: "GENERAL_SERVICES_EDUCATION",
  });
  const asOf = "2026-11-03";

  it("counts across the months in history, not the three it's averaged over", () => {
    const spent = typicalMonthlySpending([...month, tuition], asOf, 3);
    // Within the few cents that dividing it into equal parts leaves.
    expect(Math.abs(spent - (100_000 + 481_500 / 7))).toBeLessThan(5);
  });

  it("lands the same on every window, so a month's average doesn't jump when it arrives", () => {
    const before = typicalMonthlySpending([...month, tuition], "2026-11-03", 3);
    const later = typicalMonthlySpending([...month, tuition], "2026-11-03", 6);
    expect(Math.abs(before - later)).toBeLessThanOrEqual(1);
  });

  it("names what it spread, with what it cost and over how many months", () => {
    expect(rareBills([...month, tuition], asOf)).toEqual([
      { date: "2026-08-24", merchant: "University Bursar", amountCents: 481_500, overMonths: 7 },
    ]);
  });

  it("leaves a bill that comes most months, and a small one", () => {
    const small = t({
      date: "2026-08-24",
      amountCents: 40_000,
      merchantName: "Geico",
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_INSURANCE",
    });
    const monthlyCare = MONTHS_7.map((m) =>
      t({
        date: `${m}-11`,
        amountCents: 150_000,
        merchantName: "Sunrise Learning",
        pfcPrimary: "GENERAL_SERVICES",
        pfcDetailed: "GENERAL_SERVICES_CHILDCARE",
      }),
    );
    expect(rareBills([...month, small, ...monthlyCare], asOf)).toEqual([]);
  });

  it("spreads over a year at most, and property tax counts too", () => {
    const years = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 10 + i, 3)).toISOString().slice(0, 10);
      return t({ date: d, amountCents: 100_000, merchantName: "Rent" });
    });
    const tax = t({
      date: "2026-10-28",
      amountCents: 412_287,
      merchantName: "King County Treasury",
      pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
      pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    });
    expect(rareBills([...years, tax], asOf)[0].overMonths).toBe(12);
  });
});
