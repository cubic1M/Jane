import { describe, expect, it } from "vitest";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { LoanApplicationView } from "@/lib/loan-application-status";
import { loansSource } from "./sources/loans";
import type { Snapshot } from "./snapshot";

// Spec step 112: Jane follows each loan application by herself and says how it's going,
// once each.

const NOW = new Date("2026-10-25T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const app = (over: Partial<LoanApplicationView>): LoanApplicationView => ({
  id: "a1",
  debtKey: "account:car",
  oldAccountId: "car",
  oldName: "Demo Car Loan",
  partner: "demo",
  offerId: "demo-harbor-564-36",
  lender: "Harbor Auto Refi",
  product: "auto",
  aprBps: 564,
  rateType: "fixed",
  termMonths: 36,
  amountCents: 1_802_000,
  feeCents: 0,
  monthlyCents: 54_527,
  totalCents: 1_962_964,
  savingCents: 37_128,
  status: "draft",
  applicant: {
    name: "Sam",
    email: "s@example.com",
    payingOff: "Demo Car Loan",
    amountCents: 1_802_000,
  },
  partnerApplicationId: "demo-app-1",
  reviewedAt: null,
  submittedAt: null,
  acceptedAt: null,
  fundedAt: null,
  paidOffAt: null,
  createdAt: ago(5),
  ...over,
});
const gather = (apps: LoanApplicationView[]) =>
  loansSource.gather(
    { loanApplications: apps } as unknown as Snapshot,
    {
      now: NOW,
      local: { date: "2026-10-25", hour: 8 },
      trigger: "sync",
    } as never,
  );

describe("Jane's loan application messages", () => {
  it("reminds about an approved loan a day on, with Accept", () => {
    expect(gather([app({ status: "approved", submittedAt: ago(0.5) })])).toEqual([]);
    const [m] = gather([app({ status: "approved", submittedAt: ago(2) })]);
    expect(m).toMatchObject({
      kind: "decision",
      dedupeKey: "approved:a1",
      priority: MESSAGE_PRIORITY.loan_approved,
      refs: { applicationId: "a1" },
    });
    expect(m.actions.map((a) => a.id)).toEqual(["loan.accept", "loan.withdraw", "open"]);
    expect(m.body).toContain("nothing is signed until you accept");
  });

  it("says it's funded, and warns when the old loan still shows a balance much later", () => {
    const [funded] = gather([app({ status: "funded", fundedAt: ago(1) })]);
    expect(funded).toMatchObject({ kind: "done", dedupeKey: "funded:a1" });
    const [late] = gather([app({ status: "funded", fundedAt: ago(12) })]);
    expect(late).toMatchObject({
      kind: "heads_up",
      dedupeKey: "late:a1",
      priority: MESSAGE_PRIORITY.loan_payoff_late,
    });
    expect(late.body).toContain("don't pay both");
  });

  it("confirms the payoff, and says nothing for drafts, declines or withdrawals", () => {
    const [paid] = gather([app({ status: "paid_off", fundedAt: ago(3), paidOffAt: ago(1) })]);
    expect(paid.body).toBe(
      "Your Demo Car Loan is paid off: your bank shows it at zero. Your new Harbor Auto Refi loan is $545.27 a month at 5.64%, about $371.28 less than keeping the old one. I've added it to your debts.",
    );
    for (const status of ["draft", "declined", "withdrawn", "accepted"] as const) {
      expect(gather([app({ status })])).toEqual([]);
    }
  });
});
