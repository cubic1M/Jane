import { describe, expect, it } from "vitest";
import { ALLOWED_SOURCE_HOSTS } from "@/config/tax-params";
import { FIGURE_IDS, type FigureId } from "./figures";
import { CASE_YEARS, FUTURE_INPUTS, INPUT_KEYS, loadCases, runCase } from "./serialize";

// The accuracy bench (Tax T2): every fixed case through today's estimator. A case that is wrong
// because of a defect the roadmap knows is an expected failure: the bench asserts that exactly the
// figures it names are wrong, so the case can neither be deleted nor quietly start passing.

const STEP = /^(T([4-9]|[12]\d|3[0-4])|unowned)$/;
const hostOk = (url: string) => {
  const u = new URL(url);
  return (
    u.protocol === "https:" &&
    ALLOWED_SOURCE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
  );
};

describe.each(CASE_YEARS)("bench cases for %i", (year) => {
  const cases = loadCases(year);

  it("has cases, with distinct ids, filed under their own year", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => c.taxYear !== year).map((c) => c.id)).toEqual([]);
  });

  it("names a source for every case: a page on an IRS or law site, and where in it", () => {
    for (const c of cases) {
      expect(hostOk(c.source.url), `${c.id}: ${c.source.url}`).toBe(true);
      expect(c.source.where.length, c.id).toBeGreaterThan(10);
      if (c.source.kind === "hand")
        expect(c.note?.length ?? 0, `${c.id} needs its arithmetic`).toBeGreaterThan(20);
    }
  });

  it("expects whole cents of known figures, and widens a tolerance only with a reason", () => {
    for (const c of cases) {
      const ids = Object.keys(c.expected);
      expect(ids.length, c.id).toBeGreaterThan(0);
      for (const id of ids) expect(FIGURE_IDS, `${c.id}: ${id}`).toContain(id);
      for (const v of Object.values(c.expected)) expect(Number.isInteger(v), c.id).toBe(true);
      if (c.tolerance) expect(c.note, `${c.id} widens a tolerance`).toMatch(/Tax Table|rounding/);
    }
  });

  it("gives the estimator only inputs it takes, or ones a later step is listed as adding", () => {
    for (const c of cases)
      for (const key of Object.keys(c.extra ?? {}))
        expect(INPUT_KEYS.has(key) || key in FUTURE_INPUTS, `${c.id}: ${key}`).toBe(true);
  });

  it("names, for every expected failure, a roadmap step (or unowned) and figures it expects", () => {
    for (const c of cases.filter((x) => x.expectedFailure)) {
      const f = c.expectedFailure!;
      expect(f.steps.length, c.id).toBeGreaterThan(0);
      for (const s of f.steps) expect(s, c.id).toMatch(STEP);
      expect(f.figures.length, c.id).toBeGreaterThan(0);
      for (const id of f.figures) expect(Object.keys(c.expected), c.id).toContain(id);
      expect(f.reason.length, c.id).toBeGreaterThan(30);
    }
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { wrong } = runCase(c);
    if (!c.expectedFailure) {
      expect(wrong, "figures the estimate gets wrong").toEqual([]);
      return;
    }
    const want = [...c.expectedFailure.figures].sort() as FigureId[];
    expect(
      wrong.sort(),
      `expected failure (${c.expectedFailure.steps.join(", ")}): the figures wrong today. If it is now empty the step has landed: remove expectedFailure`,
    ).toEqual(want);
  });
});

describe("future inputs", () => {
  it("lists none the estimator takes by now, each with a roadmap step", () => {
    for (const [key, step] of Object.entries(FUTURE_INPUTS)) {
      expect(INPUT_KEYS.has(key), key).toBe(false);
      expect(step, key).toMatch(STEP);
    }
  });

  it("are all carried by a case that waits on their step", () => {
    const used = new Set(
      CASE_YEARS.flatMap(loadCases).flatMap((c) =>
        Object.keys(c.extra ?? {}).filter((k) => k in FUTURE_INPUTS),
      ),
    );
    expect([...used].sort()).toEqual(Object.keys(FUTURE_INPUTS).sort());
  });
});

describe("the bench as a whole", () => {
  const all = CASE_YEARS.flatMap(loadCases);

  it("has at least 8 cases, each with a source address", () => {
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.every((c) => c.source.url.startsWith("https://"))).toBe(true);
  });

  it("has IRS examples", () => {
    expect(all.filter((c) => c.source.kind === "irs_example").length).toBeGreaterThanOrEqual(8);
  });
});
