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
      const run = runScenario(s, baseline);
      expect(run.sectors.forecast.length, s).toBeGreaterThan(10);
      expect(run.sectors.insurance.length, s).toBeGreaterThan(0);
      expect(run.after.rows).toHaveLength(12);
    }
  });

  it("job loss: cash runs out, goals slip, the plan pauses extras and trims", () => {
    const run = runScenario("job_loss", baseline, { months: 6 });
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

  it("a raise raises the margin and slips nothing", () => {
    const run = runScenario("raise", baseline);
    expect(run.after.marginCents).toBe(210_000);
    expect(run.sectors.goals[0].status).toBe("fine");
    expect(run.sectors.taxes).toMatch(/more in tax/);
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
