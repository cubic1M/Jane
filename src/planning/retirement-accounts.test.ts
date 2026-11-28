import { describe, expect, it } from "vitest";
import { retirementLimits } from "@/config/retirement";
import { NoTaxParamsError } from "@/config/tax-params";
import { limitRows, matchGap, rothAccess, rothByBracket } from "./retirement-accounts";

// Spec step 210: every limit tracked, the match in dollars, Roth by bracket, the backdoor.

describe("limitRows", () => {
  it("tracks the workplace and IRA limits with catch-up from 50 and 60 to 63", () => {
    const at = (age: number) =>
      limitRows({ age, year: 2026, workplaceUsedCents: 1_632_000, iraUsedCents: 200_000 }).map(
        (l) => [l.limitCents, l.catchUpCents, l.roomCents],
      );
    expect(at(45)).toEqual([
      [2_450_000, 0, 818_000],
      [750_000, 0, 550_000],
    ]);
    expect(at(52)).toEqual([
      [3_250_000, 800_000, 1_618_000],
      [860_000, 110_000, 660_000],
    ]);
    expect(at(61)[0]).toEqual([3_575_000, 1_125_000, 1_943_000]);
    expect(at(64)[0][1]).toBe(800_000);
  });
  it("never shows negative room, and the limits carry their year and source", () => {
    expect(
      limitRows({ age: 30, year: 2026, workplaceUsedCents: 9_000_000, iraUsedCents: 0 })[0]
        .roomCents,
    ).toBe(0);
    expect(retirementLimits(2026).year).toBe(2026);
    expect(retirementLimits(2026).source).toMatch(/IRS Notice 2025-67/);
  });
  // Notice 2026-66 for 2027: 25,500 dollars, catch-up 8,500 and 11,750 at 60 to 63, IRA 7,500 and
  // 1,100. Each year reads its own; a year without figures has none.
  it("reads the year's own limits", () => {
    const at = (age: number, year: number) =>
      limitRows({ age, year, workplaceUsedCents: 0, iraUsedCents: 0 }).map((l) => l.limitCents);
    expect(at(45, 2027)).toEqual([2_550_000, 750_000]);
    expect(at(52, 2027)).toEqual([2_550_000 + 850_000, 750_000 + 110_000]);
    expect(at(61, 2027)[0]).toBe(2_550_000 + 1_175_000);
    expect(at(45, 2025)).toEqual([2_350_000, 700_000]);
    expect(retirementLimits(2027).source).toMatch(/Notice 2026-66/);
    expect(() => at(45, 2028)).toThrow(NoTaxParamsError);
  });
});

describe("matchGap", () => {
  it("shows the missed match as dollars a year (the demo employee: 4% of $81,600, match up to 6%)", () => {
    expect(
      matchGap({ payCents: 8_160_000, employeeCents: 326_400, matchRate: 0.5, matchUpTo: 0.06 }),
    ).toEqual({
      employeeRate: 0.04,
      fullMatchRate: 0.06,
      missedCents: 81_600,
      extraEmployeeCents: 163_200,
    });
  });
  it("has nothing missed once the whole match is captured", () => {
    expect(
      matchGap({ payCents: 8_160_000, employeeCents: 612_000, matchRate: 0.5, matchUpTo: 0.06 })
        .missedCents,
    ).toBe(0);
  });
});

describe("Roth or traditional, and the backdoor", () => {
  it("chooses by the federal bracket on the next dollar", () => {
    expect(rothByBracket(0.12)).toBe("roth");
    expect(rothByBracket(0.22)).toBe("mix");
    expect(rothByBracket(0.24)).toBe("traditional");
    expect(rothByBracket(null)).toBeNull();
  });
  it("opens a Roth IRA directly, in part, or only by the backdoor, by filing status", () => {
    expect(rothAccess(10_000_000, "single")).toEqual({ kind: "direct", allowedShare: 1 });
    expect(rothAccess(16_050_000, "single")).toMatchObject({ kind: "partial", allowedShare: 0.5 });
    const over = rothAccess(20_000_000, "single");
    expect(over.kind).toBe("backdoor");
    if (over.kind === "backdoor") {
      expect(over.steps).toHaveLength(3);
      expect(over.note).toMatch(/pro-rata/);
    }
    // The same income is fine for a married couple filing jointly.
    expect(rothAccess(20_000_000, "married_joint").kind).toBe("direct");
  });
});
