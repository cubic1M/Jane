import { describe, expect, it } from "vitest";
import { RAPID_RESCORE_NOTE } from "@/config/credit-goals";
import { buildPlan, paydownBalances, planMonths } from "./credit-goal";

describe("how many months a plan has", () => {
  it("counts whole months to the date, within one and 24", () => {
    expect(planMonths("2026-10-18", "2027-04-18")).toBe(6);
    expect(planMonths("2026-10-18", "2027-04-17")).toBe(5);
    expect(planMonths("2026-10-18", "2026-10-30")).toBe(1);
    expect(planMonths("2026-10-18", "2035-01-01")).toBe(24);
  });
});

describe("the paydown", () => {
  it("brings card use under 10% of the limit by the second to last month, then holds", () => {
    // $2,410.50 on an $8,000 limit: under 10% is $799.99.
    const b = paydownBalances({ balanceCents: 241_050, limitCents: 800_000, months: 6 });
    expect(b).toHaveLength(6);
    expect(b[4]).toBe(79_999);
    expect(b[5]).toBe(79_999);
    expect(b[0]).toBeGreaterThan(b[1]);
    expect([...b].sort((x, y) => y - x)).toEqual(b);
  });
  it("pays nothing when card use is already low, and uses the single month for it", () => {
    expect(paydownBalances({ balanceCents: 50_000, limitCents: 800_000, months: 3 })).toEqual([
      50_000, 50_000, 50_000,
    ]);
    expect(paydownBalances({ balanceCents: 241_050, limitCents: 800_000, months: 1 })).toEqual([
      79_999,
    ]);
  });
});

describe("the plan", () => {
  // A score that rises as the balance falls: 700 plus a point for every $20 paid off.
  const scoreAfter = (balance: number) => 700 + Math.round((241_050 - balance) / 2_000);
  const base = {
    asOf: "2026-10-18",
    targetScore: 740,
    balanceCents: 241_050,
    limitCents: 800_000,
    cardNames: ["Demo Credit Card ····0003"],
    scoreAfter,
    inquiryCostPoints: 5,
  };

  it("reaches the target when the simulator's last month does, with a checklist each month", () => {
    const plan = buildPlan({ ...base, kind: "car", months: 6 });
    expect(plan.months.map((m) => m.month)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(plan.endScore).toBe(scoreAfter(79_999));
    expect(plan.reaches).toBe(plan.endScore >= 740);
    expect(plan.reaches).toBe(true);
    expect(plan.totalPayCents).toBe(241_050 - 79_999);
    for (const m of plan.months) {
      expect(m.items.map((i) => i.key)).toEqual(
        m.payCents > 0
          ? ["pay", "keep_open", "no_inquiry", "on_time"]
          : ["keep_open", "no_inquiry", "on_time"],
      );
      expect(m.items.find((i) => i.key === "no_inquiry")!.text).toContain("about 5 points");
    }
    expect(plan.months[0].items[0].text).toMatch(
      /^Pay \$\d[\d,.]+ toward your cards before their statements close/,
    );
    // Projected scores never fall as balances do.
    const scores = plan.months.map((m) => m.projectedScore);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  it("says when the target can't be reached, and the best it shows", () => {
    const plan = buildPlan({ ...base, kind: "car", months: 6, targetScore: 800 });
    expect(plan.reaches).toBe(false);
    expect(plan.best).toBe(plan.endScore);
  });

  it("adds a rapid rescore to the last month, for a mortgage only", () => {
    const mortgage = buildPlan({ ...base, kind: "mortgage", months: 4 });
    expect(
      mortgage.months
        .at(-1)!
        .items.some((i) => i.key === "rescore" && i.text.includes(RAPID_RESCORE_NOTE)),
    ).toBe(true);
    expect(mortgage.months[0].items.some((i) => i.key === "rescore")).toBe(false);
    const car = buildPlan({ ...base, kind: "car", months: 4 });
    expect(car.months.some((m) => m.items.some((i) => i.key === "rescore"))).toBe(false);
  });
});
