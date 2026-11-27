import { describe, expect, it } from "vitest";
import { SCENARIOS } from "@/config/what-if";
import { cashFlowChange, project, runScenario, type WhatIfBaseline } from "./what-if";

const baseline: WhatIfBaseline = {
  cashCents: 1_200_000,
  monthlyIncomeCents: 600_000,
  monthlySpendingCents: 450_000,
  marginalRate: 0.22,
  goals: [{ id: "g1", name: "Emergency fund", monthlyNeededCents: 100_000 }],
  debt: { hasDebts: true, before: "2027-08", after: "2028-02" },
};
const none = {
  incomeLossShare: 0,
  months: 0,
  extraMonthlyCents: 0,
  savedMonthlyCents: 0,
  oneTimeCents: 0,
};

describe("project", () => {
  it("is cash plus income less spending, month by month", () => {
    const p = project(baseline, none);
    expect(p.rows[0].balanceCents).toBe(1_350_000);
    expect(p.rows[11].balanceCents).toBe(1_200_000 + 12 * 150_000);
    expect(p.runsOutMonth).toBeNull();
    expect(p.marginCents).toBe(150_000);
  });

  it("loses all income for the months asked, then recovers the margin", () => {
    const p = project(baseline, { ...none, incomeLossShare: 1, months: 4 });
    expect(p.rows[3].balanceCents).toBe(1_200_000 - 4 * 450_000);
    expect(p.rows[4].balanceCents - p.rows[3].balanceCents).toBe(150_000);
    expect(p.runsOutMonth).toBe(3);
    expect(p.lowestCents).toBe(p.rows[3].balanceCents);
  });

  it("takes a one-time cost in the first month", () => {
    expect(project(baseline, { ...none, oneTimeCents: 500_000 }).rows[0].balanceCents).toBe(
      850_000,
    );
  });
});

describe("runScenario", () => {
  it("runs every scenario with a plain-words line for each sector", () => {
    for (const s of SCENARIOS) {
      const run = runScenario(s, baseline, {}, { advice: true });
      expect(run.sectors.forecast.length, s).toBeGreaterThan(10);
      expect(run.sectors.insurance.length, s).toBeGreaterThan(0);
      expect(run.after.rows).toHaveLength(12);
    }
  });

  it("job loss: cash runs out, goals slip, the plan pauses extras and trims", () => {
    const run = runScenario("job_loss", baseline, { months: 6 }, { advice: true });
    expect(run.after.runsOutMonth).toBe(3);
    expect(run.sectors.goals[0].status).toBe("slips");
    expect(run.sectors.debt).toBe("Debt-free moves from August 2027 to February 2028.");
    expect(run.sectors.taxes).toBe(
      "About $7,920.00 less in tax for the year, at your 22% rate on the next dollar.",
    );
    expect(run.plan.map((c) => c.key)).toEqual(
      expect.arrayContaining(["pause-extra", "goal:g1", "cover:3"]),
    );
  });

  // CodeRabbit part 2 (open O26): a real account is shown what is true about cover, never what to
  // check or what fills a gap; that is demo advice only.
  it("a real account gets cover facts, no cover advice and no cover step in the plan", () => {
    for (const s of SCENARIOS) {
      const run = runScenario(s, baseline);
      expect(run.advice, s).toBe(false);
      expect(run.sectors.insurance.join(" "), s).not.toMatch(
        /check|COBRA|marketplace|worth a look|matter more|can fill/i,
      );
      expect(
        run.plan.filter((c) => c.key.startsWith("cover:")),
        s,
      ).toEqual([]);
    }
    expect(runScenario("job_loss", baseline).sectors.insurance).toEqual([
      "Health, disability and life cover through work usually end with the job.",
    ]);
  });

  it("a raise raises the margin and slips nothing", () => {
    const run = runScenario("raise", baseline);
    expect(run.after.marginCents).toBe(210_000);
    expect(run.sectors.goals[0].status).toBe("fine");
    expect(run.sectors.taxes).toMatch(/more in tax/);
  });

  // Walk 11-26. By hand: cash $12,000, spending $4,500 a month, income $6,000. Four months with no
  // income: $12,000 - 4 x $4,500 = -$6,000, so cash runs out; the margin is back to +$1,500, so
  // there is nothing to trim.
  it("has no trim step when cash runs out but the margin comes back", () => {
    const run = runScenario("job_loss", baseline, { incomeLossShare: 1, months: 4 });
    expect(run.after.runsOutMonth).not.toBeNull();
    expect(run.after.marginCents).toBe(150_000);
    expect(run.plan.map((c) => c.key)).toContain("pause-extra");
    expect(run.plan.some((c) => /Trim spending/.test(c.title))).toBe(false);
    expect(run.plan.every((c) => !/\$0\.00/.test(c.title))).toBe(true);
  });

  it("has a trim step worth the shortfall when spending sits above income", () => {
    const run = runScenario("job_loss", { ...baseline, monthlyIncomeCents: 400_000 });
    expect(run.plan.find((c) => c.key === "trim")?.title).toBe("Trim spending by $500.00 a month");
  });

  it("leaves tax and debt out when there is nothing to say", () => {
    const run = runScenario("car", {
      ...baseline,
      marginalRate: null,
      debt: { hasDebts: false, before: null, after: null },
    });
    expect(run.sectors.taxes).toBeNull();
    expect(run.sectors.debt).toBeNull();
  });
});

describe("cashFlowChange", () => {
  it("is the monthly income lost and the new spending, for the debt plan", () => {
    expect(cashFlowChange(baseline, { ...none, incomeLossShare: 1, months: 12 })).toBe(-600_000);
    expect(cashFlowChange(baseline, { ...none, extraMonthlyCents: 90_000 })).toBe(-90_000);
    // A short change doesn't move the year's plan.
    expect(cashFlowChange(baseline, { ...none, incomeLossShare: 1, months: 4 })).toBe(0);
  });
});
