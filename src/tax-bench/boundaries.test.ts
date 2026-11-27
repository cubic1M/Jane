import { describe, expect, it } from "vitest";
import { judge, probePlan } from "./probes";
import { ESTIMATOR_YEARS } from "./serialize";

// Tax T2: the figure just before, at and just after every threshold the estimate reads, with the
// shape the law gives it there (a bracket starts, a phase-out starts or ends, a cap is reached).

describe.each(ESTIMATOR_YEARS)("boundaries, %i", (year) => {
  const probes = Object.entries(probePlan(year)).flatMap(([group, plan]) =>
    "probes" in plan ? plan.probes.map((p) => [`${group} ${p.param}`, p] as const) : [],
  );

  it("probes dozens of thresholds", () => {
    expect(probes.length).toBeGreaterThanOrEqual(80);
  });

  it.each(probes)("%s", (_name, probe) => {
    const r = judge(probe);
    expect(r.ok, r.seen).toBe(true);
  });
});
