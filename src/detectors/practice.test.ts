import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE, type PersonId } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { shortFormProblems } from "./harness";
import { PRACTICE_DETECTORS } from "./practice";
import { runDetectors } from "./index";

// Spec step 296: "Start a practice portfolio" reaches the sample people still building up who
// don't invest on their own yet, and nobody in debt trouble, near retirement or in it.

const WHO: readonly PersonId[] = ["renter", "family", "freelancer", "owner"];

const run = (data: ReturnType<typeof inputFor>) =>
  runDetectors({ profile: buildProfile(data), data }, PRACTICE_DETECTORS);

describe("the practice portfolio detector", () => {
  it("fires for the right sample people and no one else", () => {
    for (const p of PEOPLE) {
      const fired = run(inputFor(p.id)).some((s) => s.topic === "practice_portfolio");
      expect(fired, p.id).toBe(WHO.includes(p.id));
      if (p.mustNot.includes("practice_portfolio")) expect(fired, p.id).toBe(false);
    }
  });

  it("gives a short form, a percentage with its reason, and the practice page", () => {
    for (const id of WHO) {
      const [s] = run(inputFor(id));
      expect(shortFormProblems(s)).toEqual([]);
      expect(s.confidence.percent).toBeGreaterThan(0);
      expect(s.confidence.reason.length).toBeGreaterThan(0);
      expect(s.action.href).toBe("/investments/practice");
      expect(s.why).toMatch(/practice money/);
    }
  });

  it("stays quiet once the person has a practice portfolio, or invests on their own", () => {
    const data = inputFor("renter");
    const extras = { householdMembers: 0, ...data.extras, hasPracticePortfolio: true };
    expect(run({ ...data, extras })).toEqual([]);
    const brokerage = { ...data.accounts[0], id: "b", type: "investment", subtype: "brokerage" };
    expect(run({ ...data, accounts: [...data.accounts, brokerage] })).toEqual([]);
  });
});
