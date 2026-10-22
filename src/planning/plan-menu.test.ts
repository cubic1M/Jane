import { describe, expect, it } from "vitest";
import {
  cheapestMix,
  classOf,
  currentAllocation,
  parseDisclosure,
  targetDateCheck,
  targetFor,
  weightedBps,
  yearlyCents,
} from "./plan-menu";

// Spec step 232: the menu read from a disclosure, the cheapest mix from it, the target-date
// check, and the saving in dollars a year. Only funds on the menu are suggested.

const DISCLOSURE = `
Plan fee disclosure (annual operating expenses)
NSTDX  Northstar Target 2055 Fund  0.75%  Target date
SLGFX  Summit Large Cap Growth Fund  1.02%  US stock
KTSIX  Keystone Total US Stock Index Fund  0.03%  US stock
KTIIX  Keystone International Stock Index Fund  0.08%  International stock
KTBIX  Keystone Total Bond Index Fund  0.05%  Bond
DSVXX  Demo Stable Value Fund  0.35%  Stable value
Page 2 of 3
`;
const OPTS = { today: "2026-10-19", risk: 3 as const };

describe("parseDisclosure", () => {
  it("reads each fund's ticker, cost and kind, and says what it skipped", () => {
    const { funds, skipped } = parseDisclosure(DISCLOSURE, OPTS);
    expect(funds.map((f) => [f.ticker, f.expenseBps, f.kind])).toEqual([
      ["NSTDX", 75, "target_date"],
      ["SLGFX", 102, "us_stocks"],
      ["KTSIX", 3, "us_stocks"],
      ["KTIIX", 8, "intl_stocks"],
      ["KTBIX", 5, "bonds"],
      ["DSVXX", 35, "cash"],
    ]);
    expect(skipped).toEqual(["Plan fee disclosure (annual operating expenses)", "Page 2 of 3"]);
    expect(funds[0].mix).toMatchObject({ us_stocks: 0.54, intl_stocks: 0.36, bonds: 0.1 });
  });
  it("ignores duplicates and costs that can't be right", () => {
    const { funds } = parseDisclosure(
      "AAAAX  Some Fund  0.10%\nAAAAX  Some Fund again  0.20%\nBBBBX  Weird Fund  900%",
      OPTS,
    );
    expect(funds.map((f) => f.ticker)).toEqual(["AAAAX"]);
  });
  it("classes names by what they hold", () => {
    expect(classOf("Acme Retirement 2045 Fund")).toBe("target_date");
    expect(classOf("Core Plus Bond Fund")).toBe("bonds");
    expect(classOf("Emerging Markets Equity")).toBe("intl_stocks");
    expect(classOf("Mystery Thing")).toBe("other");
  });
});

describe("the cheapest mix from the plan's own funds", () => {
  const { funds } = parseDisclosure(DISCLOSURE, OPTS);
  it("picks the cheapest fund of each kind and matches the target", () => {
    const m = cheapestMix(funds, targetFor(3));
    // Target: 40% US, 20% international, 35% bonds, 5% cash.
    expect(m.allocation.map((a) => [a.ticker, Math.round(a.share * 100)])).toEqual([
      ["KTSIX", 40],
      ["KTIIX", 20],
      ["KTBIX", 35],
      ["DSVXX", 5],
    ]);
    // 0.4×3 + 0.2×8 + 0.35×5 + 0.05×35 = 6.30 basis points.
    expect(m.bps).toBeCloseTo(6.3, 5);
    expect(m.missing).toEqual([]);
    // Only funds on the menu.
    const menu = new Set(funds.map((f) => f.ticker));
    expect(m.allocation.every((a) => menu.has(a.ticker))).toBe(true);
  });
  it("prices the saving in dollars a year against what is held now", () => {
    // $84,250 held in the costly target-date and large-cap growth funds.
    const now = currentAllocation(funds, [
      { ticker: "NSTDX", valueCents: 4_000_000 },
      { ticker: "SLGFX", valueCents: 4_425_040 },
    ]);
    const nowBps = weightedBps(now);
    const mix = cheapestMix(funds, targetFor(3));
    expect(nowBps).toBeCloseTo((75 * 4_000_000 + 102 * 4_425_040) / 8_425_040, 5);
    const saving = yearlyCents(8_425_040, nowBps - mix.bps);
    expect(saving).toBeGreaterThan(60_000);
    expect(saving).toBe(Math.round((8_425_040 * (nowBps - mix.bps)) / 10_000));
  });
  it("says what the menu lacks and uses the closest fund it has", () => {
    const noBonds = funds.filter((f) => f.kind !== "bonds");
    const m = cheapestMix(noBonds, targetFor(3));
    expect(m.missing).toEqual(["bonds"]);
    expect(m.allocation.some((a) => a.ticker === "DSVXX")).toBe(true);
  });
});

describe("a target-date fund against building it by hand", () => {
  it("compares the fund's fee with its mix built from the cheapest funds", () => {
    const { funds } = parseDisclosure(DISCLOSURE, OPTS);
    const check = targetDateCheck(funds, funds[0], 10_000_000)!;
    expect(check.fundBps).toBe(75);
    // 54% US × 3 + 36% intl × 8 + 10% bonds × 5 = 5.00 bps.
    expect(check.handBps).toBeCloseTo(5, 5);
    expect(check.fundCents).toBe(75_000);
    expect(check.handCents).toBe(5_000);
    expect(check.savingCents).toBe(70_000);
  });
});
