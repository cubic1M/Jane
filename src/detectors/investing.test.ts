import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE, type PersonId, type SuggestionTopic } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { INVESTING_DETECTORS } from "./investing";
import { runDetectors } from "./index";

// Spec step 262: each investing detector fires for the people it is written for, and for no
// one on their must-not list, with a percentage, its reason, and the dollars.

const firedFor = (id: PersonId) => {
  const data = inputFor(id);
  return runDetectors({ profile: buildProfile(data), data }, INVESTING_DETECTORS);
};
const WHO: Record<string, PersonId[]> = {
  employer_match: ["renter"],
  catch_up: ["preretire"],
  hsa: ["equity"],
  backdoor_roth: ["equity"],
  education_529: ["family"],
  rmd: ["retiree"],
};

describe("investing detectors on the eight people", () => {
  for (const [topic, who] of Object.entries(WHO)) {
    it(`${topic} fires for ${who.join(", ")}`, () => {
      for (const p of PEOPLE) {
        const fired = firedFor(p.id).some((s) => s.topic === topic);
        if (who.includes(p.id)) expect(fired, `${p.id} should get ${topic}`).toBe(true);
        if (p.mustNot.includes(topic as SuggestionTopic)) {
          expect(fired, `${p.id} must not get ${topic}`).toBe(false);
        }
      }
    });
  }

  it("gives every suggestion dollars, a percentage with its reason, and a button", () => {
    for (const p of PEOPLE) {
      for (const s of firedFor(p.id)) {
        expect(s.worthCents).toBeGreaterThan(0);
        expect(s.confidence.percent).toBeGreaterThan(0);
        expect(s.confidence.percent).toBeLessThanOrEqual(100);
        expect(s.confidence.reason.length).toBeGreaterThan(0);
        expect(s.action.href).toMatch(/^\//);
        expect(s.why).toMatch(/\$/);
      }
    }
  });

  it("gives the same percentage for the same evidence", () => {
    const a = firedFor("renter").map((s) => [s.id, s.confidence.percent]);
    const b = firedFor("renter").map((s) => [s.id, s.confidence.percent]);
    expect(a).toEqual(b);
  });
});
