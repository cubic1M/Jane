import { describe, expect, it } from "vitest";
import { paystubSaving, sortDeduction } from "./paystub-deductions";

describe("a TSP loan repayment is not saving", () => {
  it("sorts a TSP loan line as a plan loan", () => {
    expect(sortDeduction("TSP loan", 50_000).kind).toBe("plan_loan");
    expect(sortDeduction("TSP LOAN REPAY", 50_000).kind).toBe("plan_loan");
    expect(sortDeduction("Loan repayment TSP", 50_000).kind).toBe("plan_loan");
  });
  it("does not count it toward the saving rate, and still counts TSP contributions", () => {
    const loan = paystubSaving({
      grossCents: 500_000,
      deductions: [{ name: "TSP loan", cents: 50_000 }],
    });
    expect(loan.rate).toBe(0);
    expect(loan.loanCents).toBe(50_000);
    const contribution = paystubSaving({
      grossCents: 500_000,
      deductions: [{ name: "TSP", cents: 50_000 }],
    });
    expect(contribution.rate).toBeCloseTo(0.1, 5);
    expect(sortDeduction("Roth TSP", 1).kind).toBe("roth_plan");
  });
});
