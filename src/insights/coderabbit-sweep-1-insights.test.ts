import { describe, expect, it } from "vitest";
import { debtBook, type NewLoanInput } from "./debts";
import type { Deadline } from "./deadlines";
import { comingUp } from "./coming-up";

// CodeRabbit sweep, part 1 (money figures), src/insights chunk 1: each case is a finding
// reproduced against the code first (failing), then fixed.

describe("a new loan's payments made", () => {
  const loan: NewLoanInput = {
    applicationId: "app1",
    lender: "Clearwater",
    product: "personal",
    aprBps: 1_200,
    rateType: "fixed",
    termMonths: 36,
    amountCents: 1_000_000,
    monthlyCents: 33_000,
    fundedOn: "2026-10-20",
  };
  const book = (asOf: string) =>
    debtBook({ accounts: [], plans: [], typed: [], newLoans: [loan] }, asOf).debts.find(
      (d) => d.key === "loan:app1",
    )!;
  it("counts none before the first anniversary, so the first payment is still due", () => {
    const d = book("2026-11-15");
    expect(d.balanceCents).toBe(1_000_000);
    expect(d.nextDue).toBe("2026-11-20");
  });
  it("counts one on the anniversary", () => {
    const d = book("2026-11-20");
    expect(d.balanceCents).toBeLessThan(1_000_000);
    expect(d.nextDue).toBe("2026-12-20");
  });
  it("shows a loan paid off early as owing nothing and due nothing", () => {
    const d = debtBook(
      { accounts: [], plans: [], typed: [], newLoans: [{ ...loan, paidOff: true }] },
      "2026-11-15",
    ).debts.find((x) => x.key === "loan:app1")!;
    expect(d.balanceCents).toBe(0);
    expect(d.nextDue).toBeNull();
    expect(d.dueSoon).toBe(false);
  });
  it("clamps a due date on the 31st to the end of a short month", () => {
    const d = debtBook(
      { accounts: [], plans: [], typed: [], newLoans: [{ ...loan, fundedOn: "2026-01-31" }] },
      "2026-02-10",
    ).debts.find((x) => x.key === "loan:app1")!;
    expect(d.nextDue).toBe("2026-02-28");
  });
});

describe("a return window isn't a bill", () => {
  const returnWindow: Deadline = {
    key: "return:t1",
    title: "Return window for Target",
    date: "2026-10-20",
    kind: "return",
    source: "transactions",
    amountCents: 10_000,
    href: null,
    detail: null,
  };
  it("keeps a bill of the same amount on the same day", () => {
    const rows = comingUp(
      [{ merchant: "Verizon", date: "2026-10-20", amountCents: 10_000 }],
      [returnWindow],
      "2026-10-18",
      { days: 30, limit: 7 },
    );
    expect(rows.map((r) => r.label).sort()).toEqual(["Return window for Target", "Verizon"]);
  });
  it("still merges a card payment with its deadline by amount", () => {
    const rows = comingUp(
      [{ merchant: "Chase Card", date: "2026-10-20", amountCents: 10_000 }],
      [{ ...returnWindow, kind: "payment", title: "Sapphire payment" }],
      "2026-10-18",
      { days: 30, limit: 7 },
    );
    expect(rows).toHaveLength(1);
  });
});

describe("net worth events: borrowed money", () => {
  it("is cash and debt both going up, not a refund or a gain", async () => {
    const { transactionEvent } = await import("./net-worth-events");
    const e = transactionEvent({
      date: "2026-10-05",
      amountCents: -1_000_000,
      name: "CLEARWATER LOAN PROCEEDS",
      pfcPrimary: "LOAN_DISBURSEMENTS",
      pfcDetailed: "LOAN_DISBURSEMENTS_PERSONAL_LOAN",
      accountType: "depository",
    });
    expect(e).toMatchObject({ cents: 0, moved: 1_000_000, kind: "transfer" });
    expect(e?.label).toMatch(/^Loan proceeds/);
  });
  it("leaves a real refund a refund", async () => {
    const { transactionEvent } = await import("./net-worth-events");
    const e = transactionEvent({
      date: "2026-10-05",
      amountCents: -5_000,
      name: "TARGET",
      pfcPrimary: "GENERAL_MERCHANDISE",
      pfcDetailed: "GENERAL_MERCHANDISE_OTHER",
      accountType: "depository",
    });
    expect(e).toMatchObject({ kind: "refund", cents: 5_000 });
  });
});
