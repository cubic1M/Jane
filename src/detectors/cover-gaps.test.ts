import { LIABILITY_WORTH_CAP_CENTS } from "@/config/insurance";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { COVER_GAP_DETECTORS } from "./cover-gaps";
import { reportFor } from "./harness";

// Perfect coverage, brought unasked (spec step 277): a detector per gap, reaching the right
// sample people, from the same need calculators the chat and the page use.

const firedFor = (id: string, topic: string) => {
  const data = inputFor(id);
  const profile = buildProfile(data);
  return COVER_GAP_DETECTORS.filter((d) => d.topic === topic).flatMap((d) => {
    const s = d.detect({ profile, data });
    return s ? [s] : [];
  });
};

describe("cover gap detectors", () => {
  it.each([
    ["family", "liability_levels"],
    ["renter", "liability_levels"],
    ["family", "disability_insurance"],
    ["freelancer", "disability_insurance"],
    ["owner", "disability_insurance"],
    ["family", "deductible_fit"],
    ["equity", "deductible_fit"],
  ] as const)("reaches %s with %s", (person, topic) => {
    const [s] = firedFor(person, topic);
    expect(s, `${person} ${topic}`).toBeDefined();
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.confidence.percent).toBeGreaterThan(0);
    expect(s.action.href).toMatch(/^\/insurance\?need=/);
  });

  it.each([
    ["retiree", "disability_insurance"],
    ["equity", "liability_levels"],
    ["preretire", "liability_levels"],
    ["freelancer", "liability_levels"],
  ] as const)("does not reach %s with %s", (person, topic) => {
    expect(firedFor(person, topic)).toEqual([]);
  });

  it("takes its figures from the need calculators", () => {
    const [s] = firedFor("family", "liability_levels");
    expect(s.worthCents).toBe(LIABILITY_WORTH_CAP_CENTS);
    expect(s.why).toContain("$100,000.00 per person and $300,000.00 per accident");
    const [d] = firedFor("freelancer", "disability_insurance");
    // Sam's income includes the retainer client he landed in July (step 269).
    expect(d.why).toMatch(/\$3,422\.68 a month/);
  });

  it("states a typical saving, not a quote, and caps its confidence", () => {
    const [s] = firedFor("family", "deductible_fit");
    expect(s.confidence.percent).toBeLessThanOrEqual(70);
    expect(s.confidence.reason).toMatch(/typical rate, not a quote/);
    const [dis] = firedFor("family", "disability_insurance");
    expect(dis.confidence.percent).toBeLessThanOrEqual(65);
    expect(dis.confidence.reason).toMatch(/through your job/);
  });

  it("says nothing without the policies loaded", () => {
    const data = inputFor("family");
    data.extras = { householdMembers: 0 };
    const profile = buildProfile(data);
    for (const d of COVER_GAP_DETECTORS) expect(d.detect({ profile, data })).toBeNull();
  });

  it("never tells a person something their list forbids", () => {
    for (const p of PEOPLE) {
      const wrong = reportFor(p).wrong.filter((s) =>
        ["disability_insurance", "liability_levels", "deductible_fit"].includes(s.topic),
      );
      expect(
        wrong.map((s) => s.topic),
        p.id,
      ).toEqual([]);
    }
  });
});
