import { describe, expect, it } from "vitest";
import { debtBook } from "./debts";

// CodeRabbit sweep 1b: a loan accepted through Jane and marked paid off still got the balance
// its schedule would leave.
const loan = {
  applicationId: "app1",
  lender: "Acme Bank",
  product: "personal",
  aprBps: 900,
  rateType: "fixed",
  termMonths: 36,
  amountCents: 1_000_000,
  monthlyCents: 31_800,
  fundedOn: "2026-06-01",
};

describe("a loan Jane funded", () => {
  it("shows the schedule's balance while it is open", () => {
    const b = debtBook({ accounts: [], plans: [], typed: [], newLoans: [loan] }, "2026-11-24");
    expect(b.debts.find((d) => d.key === "loan:app1")!.balanceCents).toBeGreaterThan(0);
  });
  it("owes nothing once marked paid off", () => {
    const b = debtBook(
      { accounts: [], plans: [], typed: [], newLoans: [{ ...loan, paidOff: true }] },
      "2026-11-24",
    );
    const d = b.debts.find((x) => x.key === "loan:app1")!;
    expect(d.balanceCents).toBe(0);
    expect(d.nextDue).toBeNull();
  });
});
