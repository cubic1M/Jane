import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { GRACE_ENDING } from "@/config/student-money";
import { PEOPLE } from "@/config/people";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { levelPaymentCents } from "@/planning/refinance";
import { buildProfile, type ProfileInput, type ProfileLiability } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HEADLINE_MAX, SHORT_MAX } from "./contract";
import { runDetectors } from "./index";
import { STUDENT_LOANS_HELD_DETECTORS } from "./student-loans-held";
import { undergrad } from "./__fixtures__/students";

// Suggest-money lane (11-18): a student loan's grace period ending.

const LOAN: ProfileLiability = {
  accountId: "fed-1",
  kind: "student",
  aprBps: 653,
  hasPmi: null,
  payoffDate: null,
  description: "Direct Unsubsidized",
  loanStatus: "in grace",
  loanStatusEndDate: "2027-01-31",
};

const withLoan = (loan: Partial<ProfileLiability> = {}, today = "2026-11-18"): ProfileInput => {
  const base = undergrad();
  return {
    ...base,
    today,
    accounts: [
      ...base.accounts,
      { id: "fed-1", type: "loan", subtype: "student", balanceCents: -1_800_000 },
    ],
    liabilities: [{ ...LOAN, ...loan }],
  };
};

const fire = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_LOANS_HELD_DETECTORS)[0] ?? null;

describe("a grace period ending", () => {
  it("says when, what's owed and the Standard payment, with the official steps", () => {
    const s = fire(withLoan())!;
    expect(s).not.toBeNull();
    expect(s.title).toContain("January 31, 2027");
    const monthly = levelPaymentCents(1_800_000, 653, GRACE_ENDING.standardMonths);
    expect(s.short).toContain(`$18,000.00`);
    expect(s.why).toContain("6.53%");
    expect(s.why).toMatch(/about \$\d{3}\.\d{2} a month/);
    expect(monthly).toBeGreaterThan(0);
    expect(s.more?.map((m) => m.href)).toContain("https://studentaid.gov/loan-simulator/");
    expect(s.urgency).toBe("soon");
    for (const text of [s.title, s.short, s.why]) {
      expect(
        checkGuardrails(
          text,
          dollarFigures(text).map((f) => f.cents),
        ),
        text,
      ).toEqual({
        ok: true,
      });
      expect(recommendsAChoice(text), text).toBe(false);
    }
    expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
    expect(s.short.length).toBeLessThanOrEqual(SHORT_MAX);
  });

  it("is told 120 days ahead and no earlier, now within 30 days, and nothing once it's past", () => {
    // Jan 31 is 120 days after Oct 3.
    expect(fire(withLoan({}, "2026-10-03"))).not.toBeNull();
    expect(fire(withLoan({}, "2026-10-02"))).toBeNull();
    expect(fire(withLoan({}, "2027-01-01"))!.urgency).toBe("now");
    expect(fire(withLoan({}, "2027-02-01"))).toBeNull();
  });

  it("is nothing for a loan in school or in repayment, without an end date, or with nothing owed", () => {
    expect(fire(withLoan({ loanStatus: "in school" }))).toBeNull();
    expect(fire(withLoan({ loanStatus: "repayment" }))).toBeNull();
    expect(fire(withLoan({ loanStatusEndDate: null }))).toBeNull();
    const paid = withLoan();
    expect(
      fire({
        ...paid,
        accounts: paid.accounts.map((a) => (a.id === "fed-1" ? { ...a, balanceCents: 0 } : a)),
      }),
    ).toBeNull();
  });

  it("leaves the payment out when the bank gives no rate", () => {
    const s = fire(withLoan({ aprBps: null }))!;
    expect(s.why).not.toContain("Standard plan");
  });

  it("fires on no sample person", () => {
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      expect(
        runDetectors({ profile: buildProfile(data), data }, STUDENT_LOANS_HELD_DETECTORS),
      ).toEqual([]);
    }
  });
});
