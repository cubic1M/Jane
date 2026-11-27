import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { SAVERS_CREDIT, SAVERS_MATCH } from "@/config/tax-rates";
import { formatCents } from "@/lib/money";
import { FILING_SINGLE_ASSUMPTION } from "@/planning/tax-profile";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";

// Debugger 11-06: a single parent (children's payments, one employer's paychecks, no filing status
// given) was measured against the $80,500 joint limit and told "$2,000 each". Then (T8) one earner with
// children was read as a head of household, and the student cards read a family as filing jointly.
// T8b: one guess for everyone who has not said how they file: married filing jointly only on a sign of
// a partner, otherwise single. Head of household is never guessed (it turns on facts Jane cannot see:
// IRS Pub. 501), so a parent it could fit is priced as single and the card says so.

const run = (told: ProfileInput["told"], topic = "savers_credit") => {
  const data: ProfileInput = {
    ...inputFor("renter"),
    today: "2026-11-06",
    told: { ...inputFor("renter").told, has_children: true, household: "family", ...told },
  };
  return (
    runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS).find(
      (s) => s.topic === topic,
    ) ?? null
  );
};

describe("the Saver's Credit for a family before they say how they file", () => {
  // Before T8b, $3,300 a month take-home (about $51,480 a year) with one earner and children was
  // measured against the head of household limit ($60,375) and shown; it is over the single limit.
  it("measures one earner with children against the single limit, and says so", () => {
    expect(run({ monthly_income: 330_000, earners: 1 })).toBeNull();
    // $2,400 a month is about $37,440: under the single limit, and only their own $2,000 counts.
    const s = run({ monthly_income: 240_000, earners: 1 })!;
    expect(s.why).toContain(`under the ${formatCents(SAVERS_CREDIT.agiLimit.single)} limit`);
    expect(s.why).not.toContain("each");
    expect(s.why).toContain(FILING_SINGLE_ASSUMPTION);
    expect(s.worthCents).toBe(20_000);
  });

  it("measures a family with two earners and no sign of a partner as single too", () => {
    // Two employers paying together are a sign of a partner (the estimate's own); two earners the
    // household guess counted are not, so a family at $4,350 a month is over the single limit.
    expect(run({ monthly_income: 435_000, earners: 2 })).toBeNull();
  });

  // Before T8b a family at $4,350 a month with two earners was shown the joint limit ($80,500).
  it("files a family with a partner the person told Jane about jointly", () => {
    const s = run({ monthly_income: 435_000, earners: 2, has_partner: true })!;
    expect(s.why).toContain(`under the ${formatCents(SAVERS_CREDIT.agiLimit.married_joint)} limit`);
    expect(s.why).not.toContain(FILING_SINGLE_ASSUMPTION);
    expect(s.worthCents).toBe(40_000);
  });

  it("uses what they said about how they file, with no assumption", () => {
    const s = run({ monthly_income: 330_000, earners: 1, filing_status: "head_of_household" })!;
    expect(s.why).toContain(
      `under the ${formatCents(SAVERS_CREDIT.agiLimit.head_of_household)} limit`,
    );
    expect(s.why).not.toContain(FILING_SINGLE_ASSUMPTION);
  });

  it("phases the 2027 Saver's Match out on the single line, and on the head of household line once told", () => {
    // About $67,860: past every phase-out but the joint one.
    expect(run({ monthly_income: 435_000, earners: 1 }, "savers_match")).toBeNull();
    // About $28,080: inside the single phase-out, under the head of household's.
    const single = run({ monthly_income: 180_000, earners: 1 }, "savers_match")!;
    const [sFrom, sTo] = SAVERS_MATCH.phaseOut.single;
    expect(single.why).toContain(`from ${formatCents(sFrom)} to ${formatCents(sTo)}`);
    expect(single.why).toContain(FILING_SINGLE_ASSUMPTION);
    const hoh = run(
      { monthly_income: 180_000, earners: 1, filing_status: "head_of_household" },
      "savers_match",
    )!;
    const [hFrom, hTo] = SAVERS_MATCH.phaseOut.head_of_household;
    expect(hoh.why).toContain(`from ${formatCents(hFrom)} to ${formatCents(hTo)}`);
    expect(hoh.why).not.toContain(FILING_SINGLE_ASSUMPTION);
    expect(hoh.worthCents).toBeGreaterThanOrEqual(single.worthCents);
  });
});
