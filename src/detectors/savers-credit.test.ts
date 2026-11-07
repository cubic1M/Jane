import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { SAVERS_CREDIT } from "@/config/tax-rates";
import { recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";

// Connectors roadmap round 17: the Saver's Credit's last year.

const run = (told: ProfileInput["told"], today = "2026-11-06") => {
  const data: ProfileInput = {
    ...inputFor("renter"),
    today,
    told: { ...inputFor("renter").told, ...told },
  };
  return runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS)[0] ?? null;
};

describe("the Saver's Credit card", () => {
  it("tells someone under the limit they may qualify, with at least 10% of $2,000", () => {
    // $2,200 a month take-home is about $34,320 gross: under the $40,250 single limit.
    const s = run({ monthly_income: 220_000, filing_status: "single" })!;
    expect(s.topic).toBe("savers_credit");
    expect(s.worthCents).toBe(20_000);
    expect(s.why).toContain("under the $40,250.00 limit");
    expect(s.why).toContain("IRA money until April 15, 2027");
    expect(s.why).toContain("from 2027 the Saver's Match replaces it");
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });

  it("counts each spouse on a joint return, against the joint limit", () => {
    const s = run({ monthly_income: 450_000, filing_status: "married_joint" })!;
    expect(s.worthCents).toBe(40_000);
    expect(s.why).toContain("$80,500.00");
    expect(s.why).toContain("$2,000.00 each");
  });

  it("says nothing over the limit, for a student, for someone in debt trouble, or after its last year", () => {
    expect(run({ monthly_income: 300_000, filing_status: "single" })).toBeNull();
    expect(run({ monthly_income: 200_000, filing_status: "single", is_student: true })).toBeNull();
    expect(
      run({ monthly_income: 200_000, filing_status: "single", debt_trouble: true }),
    ).toBeNull();
    expect(run({ monthly_income: 200_000, filing_status: "single" }, "2027-04-16")).toBeNull();
    expect(
      run({ monthly_income: 200_000, filing_status: "single" }, SAVERS_CREDIT.iraDeadline),
    ).not.toBeNull();
  });
});
