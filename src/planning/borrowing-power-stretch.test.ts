import { describe, expect, it } from "vitest";
import type { LoanOffer } from "@/lib/lenders/partner";
import { priced, paymentLimit } from "./borrowing-power";
import type { FitPerson } from "./fit";

// CodeRabbit sweep 1b: the fit engine falls back to the lowest payment when nothing is
// comfortable; "what you could borrow" showed that stretch as available.
const person: FitPerson = {
  creditScore: 700,
  incomeCents: 600_000,
  debtPaymentsCents: 0,
  cashCents: 2_000_000,
  debtTrouble: false,
};
const offer: LoanOffer = {
  id: "A",
  lender: "A",
  product: "auto",
  aprBps: 500,
  rateType: "fixed",
  termMonths: 60,
  feeCents: 0,
  feeLabel: "",
  sourceUrl: "https://example.com",
  demo: true,
};

describe("priced: a stretch is not a borrowing figure", () => {
  it("is not available when the payment is over what stays comfortable", () => {
    const limit = paymentLimit(person, "auto")!;
    // An amount whose payment is well over the comfort limit.
    const f = priced(person, "auto", 6_000_000, [offer], limit);
    expect(f.available).toBe(false);
    expect(f.why).toMatch(/comfortable/);
  });
});
