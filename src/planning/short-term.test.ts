import { describe, expect, it } from "vitest";
import {
  addMonths,
  afterTaxBps,
  compare,
  eligible,
  ladder,
  monthsBetween,
  neverPastGoal,
} from "./short-term";
import { PRODUCTS } from "@/config/short-term";

// Spec step 234: after-tax yields with the person's own state, and a ladder that never
// locks money past its goal date.

const P = (k: string) => PRODUCTS.find((p) => p.key === k)!;

describe("after-tax yields", () => {
  it("makes Treasury bills beat a higher-rate CD in a state with income tax", () => {
    // 22% federal, 6% state: a 6-month CD at 4.20% keeps 4.20 × 0.72 = 3.02%; a 4.00% bill keeps 4.00 × 0.78 = 3.12%.
    expect(afterTaxBps(P("cd_6"), 12, 0.22, 0.06)).toBe(302);
    expect(afterTaxBps(P("tbill_6"), 12, 0.22, 0.06)).toBe(312);
    // In a state with no income tax the CD wins.
    expect(afterTaxBps(P("cd_6"), 12, 0.22, 0)).toBe(328);
    expect(afterTaxBps(P("tbill_6"), 12, 0.22, 0)).toBe(312);
  });
  it("charges an I bond cashed before 5 years its last 3 months of interest", () => {
    // 4.03% less 3 of 24 months of interest: 3.526% gross, ×0.78 after 22% (state-free).
    expect(afterTaxBps(P("ibond"), 24, 0.22, 0.06)).toBe(275);
    expect(afterTaxBps(P("ibond"), 72, 0.22, 0.06)).toBe(314);
  });
  it("offers only what can't lock the money past the date", () => {
    expect(eligible(2).map((p) => p.key)).toEqual(["hysa"]);
    expect(eligible(5).map((p) => p.key)).toEqual(["hysa", "tbill_3", "cd_3"]);
    expect(eligible(12).map((p) => p.key)).toContain("ibond");
    const c = compare({ amountCents: 10_000_000, months: 5, fed: 0.22, state: 0.06 });
    expect(c.every((o) => o.product.lockMonths <= 5)).toBe(true);
    expect(c[0].product.key).toBe("tbill_3");
    expect(c[0].yearlyCents).toBe(Math.round((10_000_000 * c[0].afterTaxBps) / 10_000));
  });
});

describe("the ladder", () => {
  it("matures when the money is needed and never after", () => {
    for (let months = 3; months <= 36; months += 1) {
      const rungs = ladder(10_000_001, months);
      expect(rungs.reduce((s, r) => s + r.amountCents, 0)).toBe(10_000_001);
      expect(neverPastGoal(rungs, months)).toBe(true);
      for (const r of rungs) {
        expect(r.bills[0].startMonth).toBe(0);
        // Each bill starts when the last one ends: it rolls over by itself.
        r.bills.slice(1).forEach((b, i) => expect(b.startMonth).toBe(r.bills[i].endMonth));
      }
    }
  });
  it("spreads a 12-month goal across rungs and rolls the short ones", () => {
    const rungs = ladder(8_000_000, 12);
    expect(rungs).toHaveLength(4);
    expect(rungs.map((r) => r.bills[0].term)).toEqual([3, 6, 6, 12]);
    expect(rungs[0].bills.map((b) => [b.term, b.startMonth, b.endMonth])).toEqual([
      [3, 0, 3],
      [6, 3, 9],
      [3, 9, 12],
    ]);
    expect(rungs[3].bills).toEqual([{ term: 12, startMonth: 0, endMonth: 12, rateBps: 390 }]);
  });
  it("keeps money for a goal under 3 months in savings, with no bill at all", () => {
    expect(ladder(1_000_000, 2)[0].bills).toEqual([]);
  });
});

describe("dates", () => {
  it("counts whole months and adds them", () => {
    expect(monthsBetween("2026-10-18", "2027-04-18")).toBe(6);
    expect(monthsBetween("2026-10-18", "2027-04-17")).toBe(5);
    expect(addMonths("2026-10-18", 6)).toBe("2027-04-18");
  });
});
