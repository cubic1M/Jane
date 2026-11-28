import { describe, expect, it } from "vitest";
import { federalParams, isAwaited, SUPPORTED_TAX_YEARS } from "@/config/tax-params";
import { FIGURE_IDS } from "./figures";
import { probePlan } from "./probes";
import { ESTIMATOR_YEARS, loadCases } from "./serialize";

// "No figure ships without a case" (Tax T2).

describe("every year the parameters cover", () => {
  it.each(SUPPORTED_TAX_YEARS)("%i has bench cases", (year) => {
    expect(
      loadCases(year).length,
      `add bench cases for ${year} (src/tax-bench/cases/${year})`,
    ).toBeGreaterThan(0);
  });
});

describe.each(ESTIMATOR_YEARS)("every figure of the estimate has a case, %i", (year) => {
  const cases = loadCases(year);

  it.each(FIGURE_IDS)("%s", (id) => {
    const using = cases.filter((c) => id in c.expected).map((c) => c.id);
    expect(using, `no ${year} bench case checks ${id}: add one`).not.toEqual([]);
  });

  it("is not satisfied only by cases that are expected to fail", () => {
    for (const id of FIGURE_IDS) {
      const passing = cases.filter(
        (c) => id in c.expected && !c.expectedFailure?.figures.includes(id),
      );
      expect(passing.length, `${id} is checked only by expected failures`).toBeGreaterThan(0);
    }
  });
});

// The same rule for the parameters: every group of the year's figures has boundary probes, or says
// why not and which step brings it into the estimate.
const STEP = /^(T([3-9]|[12]\d|3[0-4])|none)$/;
const isRateOrShare = (path: string) => /(Rate|rate|Share|share)(\[\d+\])?$/.test(path);

function leaves(value: unknown, path: string, out: [string, number][] = []): [string, number][] {
  if (typeof value === "number") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
}

describe.each(ESTIMATOR_YEARS)("every figure of the %i parameters has a boundary probe", (year) => {
  const plan = probePlan(year);
  const all = Object.entries(federalParams(year)).filter(
    ([, g]) => typeof g === "object" && g !== null && "status" in g,
  ) as [string, { status: string; value: unknown }][];
  // An awaited group (T32b) holds no value to probe: it must be exempt, with its step.
  const awaitedKeys = all.filter(([, g]) => isAwaited(g)).map(([k]) => k);
  const groups = all.filter(([, g]) => !isAwaited(g)).map(([key, g]) => [key, g.value] as const);

  it("plans exactly the groups the year has", () => {
    expect(Object.keys(plan).sort()).toEqual(all.map(([k]) => k).sort());
  });

  it("exempts every awaited group, saying why", () => {
    for (const key of awaitedKeys) {
      const entry = plan[key];
      expect("exempt" in entry, `${key} is awaited: no probes`).toBe(true);
    }
    expect([...awaitedKeys].sort()).toEqual(year === 2027 ? ["mileage", "withholding"] : []);
  });

  it.each(groups)("%s", (key, value) => {
    const entry = plan[key];
    if ("exempt" in entry) {
      expect(entry.exempt.length, `${key}: say why`).toBeGreaterThan(20);
      expect(entry.step, key).toMatch(STEP);
      return;
    }
    expect(entry.probes.length, key).toBeGreaterThan(0);
    // Every amount in the group that is not a rate is either probed or named as an amount.
    const probed = new Set(entry.probes.map((p) => p.param));
    const loose = leaves(value, "")
      .filter(([path, n]) => n !== 0 && !isRateOrShare(path) && !probed.has(path))
      .filter(([path]) => !entry.amounts?.some((re) => re.test(path)))
      .map(([path]) => path);
    expect(
      loose,
      `${key}: figures with no probe (add one, or list it as an amount with a reason)`,
    ).toEqual([]);
  });
});
