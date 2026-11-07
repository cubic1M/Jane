import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { UTILITY_DETECTORS } from "./utilities";

// Connectors roadmap round 17: budget billing for a bill that swings with the seasons.

const MONTHS = [
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
];

const withBills = (bills: { payee: string; cents: number[] }[]) => {
  const base = inputFor("renter");
  const account = base.accounts[0]!.id;
  const data: ProfileInput = {
    ...base,
    transactions: [
      ...base.transactions.filter((t) => t.pfc !== "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"),
      ...bills.flatMap(({ payee, cents }) =>
        cents.map((amountCents, i) => ({
          date: `${MONTHS[i]}-12`,
          amountCents,
          description: payee,
          pfc: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
          accountId: account,
        })),
      ),
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }, UTILITY_DETECTORS)[0] ?? null;
};

// Heating in winter: $240 in January, $80 in spring and autumn.
const SEASONAL = [
  16_000, 22_000, 24_000, 21_000, 15_000, 9_000, 8_000, 8_500, 9_000, 8_500, 8_000, 12_000,
];

describe("the budget billing card", () => {
  it("offers to even out a bill that swings with the seasons, worth the jump over its average", () => {
    const s = withBills([{ payee: "NATIONAL GRID", cents: SEASONAL }])!;
    const average = Math.round(SEASONAL.reduce((a, b) => a + b, 0) / SEASONAL.length);
    expect(s.topic).toBe("budget_billing");
    expect(s.worthCents).toBe(24_000 - average);
    expect(s.worthKind).toBe("risk");
    expect(s.short).toContain("$80.00 to $240.00 a month");
    expect(s.why).toContain("It doesn't lower the total");
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });

  it("says nothing for a steady bill, too few months, or a small swing", () => {
    expect(withBills([{ payee: "CON ED", cents: Array(12).fill(10_000) }])).toBeNull();
    expect(withBills([{ payee: "CON ED", cents: SEASONAL.slice(0, 8) }])).toBeNull();
    // Doubling from $20 to $40 is a jump of under $50 over the average.
    expect(
      withBills([{ payee: "CON ED", cents: SEASONAL.map((c) => Math.round(c / 6)) }]),
    ).toBeNull();
  });

  it("names the payee with the biggest jump when there are two", () => {
    const s = withBills([
      { payee: "WATERTOWN ELECTRIC", cents: SEASONAL.map((c) => Math.round(c * 0.6)) },
      { payee: "EVERSOURCE GAS", cents: SEASONAL },
    ])!;
    expect(s.title).toContain("Eversource");
  });
});
