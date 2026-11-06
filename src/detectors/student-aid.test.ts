import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { FED_AUTOPAY } from "@/config/student-loans";
import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput, type ProfileLiability } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HEADLINE_MAX } from "./contract";
import { runDetectors } from "./index";
import { STUDENT_AID_DETECTORS, federalDirect } from "./student-aid";

// Connectors roadmap round 15: the federal autopay card, before December 31, 2026.

const LOAN: ProfileLiability = {
  accountId: "acc_fed",
  kind: "student",
  aprBps: 553,
  hasPmi: null,
  payoffDate: null,
  description: "Direct Unsubsidized",
  repaymentPlan: "standard",
  loanStatus: "repayment",
};

const withLoan = (loan: Partial<ProfileLiability> = {}, today = "2026-11-06") => {
  const base = inputFor("freelancer");
  const data: ProfileInput = {
    ...base,
    today,
    accounts: [
      ...base.accounts.filter((a) => a.subtype !== "student"),
      {
        id: "acc_fed",
        subtype: "student",
        balanceCents: -2_400_000,
      } as ProfileInput["accounts"][number],
    ],
    liabilities: [...base.liabilities.filter((l) => l.kind !== "student"), { ...LOAN, ...loan }],
  };
  return runDetectors({ profile: buildProfile(data), data }, STUDENT_AID_DETECTORS)[0] ?? null;
};

beforeEach(() => vi.stubEnv("CONNECTORS", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("the federal autopay card", () => {
  it("brings up the 1% cut on a federal loan being repaid, with the deadline and a confidence", () => {
    const s = withLoan()!;
    expect(s.topic).toBe("student_autopay");
    // 1% of $24,000.
    expect(s.worthCents).toBe(24_000);
    expect(s.worthKind).toBe("saves");
    expect(s.title).toBe(
      "Make sure autopay is on for your federal student loans by December 31, 2026",
    );
    expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
    expect(s.why).toContain("through June 30, 2028");
    expect(s.why).toContain("11:59 p.m. Eastern on December 31, 2026");
    expect(s.why).toContain("If autopay is already on, nothing to do.");
    expect(s.confidence.percent).toBeGreaterThan(0);
    expect(s.confidence.reason).toContain("can't see whether autopay is on");
    expect(s.urgency).toBe("soon");
    expect(s.more?.[0]?.href).toBe("https://studentaid.gov/aid-summary/loans");
  });

  it("is urgent in the last 30 days and gone after December 31", () => {
    expect(withLoan({}, "2026-12-01")!.urgency).toBe("now");
    expect(withLoan({}, FED_AUTOPAY.lastDay)).not.toBeNull();
    expect(withLoan({}, "2027-01-01")).toBeNull();
  });

  it("says nothing while CONNECTORS is off", () => {
    vi.stubEnv("CONNECTORS", "");
    expect(withLoan()).toBeNull();
  });

  it("says nothing in forbearance, deferment or default, or before repayment starts", () => {
    for (const loanStatus of ["forbearance", "deferment", "delinquent", "in school", "in grace"]) {
      expect(withLoan({ loanStatus }), loanStatus).toBeNull();
    }
    // No status from the bank: still worth checking.
    expect(withLoan({ loanStatus: null })).not.toBeNull();
  });

  it("is for federal Direct Loans only, by name or a federal-only plan", () => {
    expect(withLoan({ description: "Sallie Mae Smart Option" })).toBeNull();
    expect(
      withLoan({ description: "Student loan", repaymentPlan: "income-based repayment" }),
    ).not.toBeNull();
    expect(federalDirect({ ...LOAN, kind: "loan" })).toBe(false);
    expect(federalDirect({ ...LOAN, description: null, repaymentPlan: "unknown" })).toBe(false);
  });

  it("changes nothing for the sample people while CONNECTORS is off", () => {
    vi.stubEnv("CONNECTORS", "");
    for (const person of PEOPLE) {
      const data = inputFor(person.id);
      const found = runDetectors({ profile: buildProfile(data), data }, STUDENT_AID_DETECTORS);
      expect(found, person.id).toEqual([]);
    }
  });
});
