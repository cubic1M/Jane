import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { SAVERS_CREDIT, SAVERS_MATCH } from "@/config/tax-rates";
import { recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";

// Connectors roadmap round 17: the Saver's Credit's last year.

const run = (told: ProfileInput["told"], today = "2026-11-06", topic = "savers_credit") =>
  all(told, today).find((s) => s.topic === topic) ?? null;
const all = (
  told: ProfileInput["told"],
  today = "2026-11-06",
  accounts?: ProfileInput["accounts"],
) => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    today,
    told: { ...base.told, ...told },
    accounts: accounts ?? base.accounts,
  };
  return runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS);
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

describe("the Saver's Match card", () => {
  const match = (
    told: ProfileInput["told"],
    accounts?: ProfileInput["accounts"],
    today = "2026-11-06",
  ) => all(told, today, accounts).find((s) => s.topic === "savers_match") ?? null;
  const account = (subtype: string) => ({
    id: `acc_${subtype}`,
    type: "investment",
    subtype,
    balanceCents: 100_000,
  });

  it("gives the full $1,000 under the phase-out, less inside it, labelled proposed", () => {
    // $1,200 a month take-home is about $18,720: under $20,500 single.
    const full = match({ monthly_income: 120_000, filing_status: "single" })!;
    expect(full.worthCents).toBe(100_000);
    expect(full.title).toContain("proposed rules");
    expect(full.why).toContain(SAVERS_MATCH.rule);
    // About $28,080: half way through $20,500-$35,500.
    const part = match({ monthly_income: 180_000, filing_status: "single" })!;
    expect(part.worthCents).toBeGreaterThan(0);
    expect(part.worthCents).toBeLessThan(100_000);
    expect(match({ monthly_income: 240_000, filing_status: "single" })).toBeNull();
  });

  it("says the match can't go into a Roth IRA, and which linked accounts could take it", () => {
    const roth = match({ monthly_income: 120_000, filing_status: "single" }, [account("roth")])!;
    expect(roth.why).toContain("never into a Roth IRA");
    expect(roth.why).toContain("a Roth IRA (it can't take the match)");
    expect(roth.why).not.toContain("traditional IRA (if");
    const both = match({ monthly_income: 120_000, filing_status: "single" }, [
      account("ira"),
      account("401k"),
    ])!;
    expect(both.why).toContain(
      "a traditional IRA (if the provider accepts it); a workplace plan (if the plan opts in)",
    );
    expect(match({ monthly_income: 120_000, filing_status: "single" }, [])!.why).toContain(
      "No retirement account is linked",
    );
  });

  it("counts each spouse, and says nothing for a student, in debt trouble, or after 2027", () => {
    expect(match({ monthly_income: 200_000, filing_status: "married_joint" })!.worthCents).toBe(
      200_000,
    );
    expect(
      match({ monthly_income: 120_000, filing_status: "single", is_student: true }),
    ).toBeNull();
    expect(
      match({ monthly_income: 120_000, filing_status: "single", debt_trouble: true }),
    ).toBeNull();
    expect(
      match({ monthly_income: 120_000, filing_status: "single" }, undefined, "2028-01-01"),
    ).toBeNull();
    expect(
      match({ monthly_income: 120_000, filing_status: "single" }, undefined, "2026-08-06"),
    ).toBeNull();
  });

  it("states facts only", () => {
    const s = match({ monthly_income: 120_000, filing_status: "single" }, [account("roth")])!;
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });
});
