import { describe, expect, it } from "vitest";
import { runScenario, type WhatIfBaseline } from "./what-if";

// CodeRabbit sweep 1b: the goals' monthly needs were also reported as "left over for investing",
// and a lapse longer than the 12 projected months priced more than a year of income in the
// year's tax.
const baseline: WhatIfBaseline = {
  cashCents: 1_200_000,
  monthlyIncomeCents: 500_000,
  monthlySpendingCents: 300_000,
  marginalRate: 0.22,
  goals: [{ id: "g1", name: "Emergency fund", monthlyNeededCents: 150_000 }],
  debt: { hasDebts: false, before: null, after: null },
};
const params = {
  incomeLossShare: 0,
  months: 0,
  extraMonthlyCents: 0,
  savedMonthlyCents: 0,
  oneTimeCents: 0,
};

describe("what-if sectors", () => {
  it("takes the goals' money off what is left for investing", () => {
    const run = runScenario("job_loss", baseline, params);
    expect(run.sectors.goals[0].status).toBe("fine");
    expect(run.sectors.investing).toMatch(/\$500\.00 a month left over/);
  });
  it("prices the year's tax on 12 months at most", () => {
    const twelve = runScenario("job_loss", baseline, { ...params, incomeLossShare: 1, months: 12 });
    const eighteen = runScenario("job_loss", baseline, {
      ...params,
      incomeLossShare: 1,
      months: 18,
    });
    expect(eighteen.sectors.taxes).toBe(twelve.sectors.taxes);
  });
});
