import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { INSURANCE_DETECTORS } from "./insurance";
import { reportFor } from "./harness";
import { detectorsFor } from "./index";

// Insurance, proactive (spec step 259): each detector on the eight sample people.

const topics: string[] = INSURANCE_DETECTORS.map((d) => d.topic);
const firedFor = (id: string, topic: string, told: ProfileInput["told"] = {}) => {
  const data = inputFor(id, told);
  const profile = buildProfile(data);
  return INSURANCE_DETECTORS.filter((d) => d.topic === topic).flatMap((d) => {
    const s = d.detect({ profile, data });
    return s ? [s] : [];
  });
};

describe("the insurance detectors", () => {
  it("belong to the insurance capability, each topic once", () => {
    expect(detectorsFor("insurance").map((d) => d.topic)).toEqual(expect.arrayContaining(topics));
    expect(new Set(topics).size).toBe(topics.length);
  });

  it.each([
    ["renter", "renters_insurance"],
    ["freelancer", "health_insurance"],
    ["preretire", "long_term_care"],
    ["retiree", "medigap"],
    ["family", "insurance_shopping"],
    ["preretire", "umbrella"],
  ] as const)("reaches %s with %s", (person, topic) => {
    const [s] = firedFor(person, topic);
    expect(s, `${person} ${topic}`).toBeDefined();
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.confidence.percent).toBeGreaterThan(0);
    expect(s.confidence.reason.length).toBeGreaterThan(5);
    expect(s.why).toMatch(/\$|\d/);
  });

  it.each([
    ["family", "renters_insurance"],
    ["retiree", "renters_insurance"],
    ["renter", "umbrella"],
    ["renter", "long_term_care"],
    ["retiree", "long_term_care"],
    ["family", "medigap"],
    ["debt", "insurance_shopping"],
    ["debt", "auto_insurance"],
    ["owner", "auto_insurance"],
    ["family", "health_insurance"],
  ] as const)("does not reach %s with %s", (person, topic) => {
    expect(firedFor(person, topic)).toEqual([]);
  });

  it("gives the same percentage for the same evidence", () => {
    for (const p of PEOPLE) {
      const a = reportFor(p).fired.filter((s) => topics.includes(s.topic));
      const b = reportFor(p).fired.filter((s) => topics.includes(s.topic));
      expect(a).toEqual(b);
    }
  });

  it("never tells a person something their list forbids", () => {
    for (const p of PEOPLE) {
      const wrong = reportFor(p).wrong.filter((s) => s.capability === "insurance");
      expect(
        wrong.map((s) => s.topic),
        p.id,
      ).toEqual([]);
    }
  });

  it("makes every insurance suggestion a person should have", () => {
    const insuranceTopics = new Set([
      "health_insurance",
      "life_insurance",
      "long_term_care",
      "medigap",
      "business_insurance",
    ]);
    for (const p of PEOPLE) {
      const r = reportFor(p);
      const should = p.should.filter((t) => insuranceTopics.has(t));
      expect(r.hit.filter((t) => insuranceTopics.has(t)).sort(), p.id).toEqual(should.sort());
    }
  });

  it("says the open enrollment window for health plans, and that it is a comparison", () => {
    const [s] = firedFor("freelancer", "health_insurance");
    expect(s.title).toMatch(/Compare health plans/);
    expect(s.why).toMatch(/Nov 1 to Jan 15/);
    expect(s.urgency).toBe("soon");
  });
});
