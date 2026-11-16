import { describe, expect, it } from "vitest";
import { studentReply } from "@/lib/jane-agent/student-replies";
import type { StudentLoans } from "@/lib/student-loans";
import { compareStudentPlans, type StudentInput } from "./student-loans";

// Debugger 11-16 (Plaid sandbox student loan, phone): the bank's minimum was $25 on a
// $14,688.10 loan at 5.5%, about $67 of interest a month. "Your plan now" read "$15,000.00 in
// all" (600 months of $25, less than the loan) with nothing forgiven, and the pick said the
// plan now cost less than Standard.

const input: StudentInput = {
  balanceCents: 1_468_810,
  aprBps: 550,
  currentPaymentCents: 2_500,
  agiCents: 4_290_000,
  familySize: 1,
  dependants: 0,
  borrower: "new",
  publicService: false,
  paymentsCounted: 3,
};

describe("a payment that never pays the loan off", () => {
  it("says what's still owed, not a total smaller than the loan", () => {
    const now = compareStudentPlans(input, { advice: false }).results.find(
      (r) => r.plan === "current",
    )!;
    expect(now.forgivenCents).toBe(0);
    expect(now.leftCents).toBeGreaterThan(input.balanceCents);
  });

  it("the pick doesn't call staying on it cheaper", () => {
    const why = compareStudentPlans(input, { advice: true }).pick!.why.join(" ");
    expect(why).not.toMatch(/costs about the same|isn't worth the paperwork/);
    expect(why).toContain("$25.00 a month doesn't pay the loan off in 50 years");
  });

  it("the chat's plan list says it isn't paid off", () => {
    const comparison = compareStudentPlans(input, { advice: false });
    const reply = studentReply({
      advice: false,
      loan: { name: "Direct Loan ····7710", balanceCents: 1_468_810, aprBps: 550 },
      profile: {
        agiCents: null,
        familySize: 1,
        dependants: 0,
        borrower: "new",
        publicService: false,
        countedBefore: 0,
        stepsDone: 0,
      },
      agiCents: input.agiCents,
      agiFrom: "paychecks",
      comparison,
      paymentsSeen: 3,
      paymentsCounted: 3,
      countingToward: { name: "IBR forgiveness", needed: 240 },
    } as unknown as StudentLoans);
    expect(reply.body).toContain("Your plan now: $25.00 a month, not paid off in 50 years");
    expect(reply.body).not.toContain("$15,000.00 in all");
  });
});
