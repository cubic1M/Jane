import { describe, expect, it } from "vitest";
import { MEDICAL_RULES } from "@/config/medical-bills";
import { medicalItems, planTerms, type MedicalBillInput } from "./medical-bills";

const bill = (amountCents: number): MedicalBillInput => ({
  key: "typed:b1",
  provider: "Mercy Hospital",
  amountCents,
  billedOn: "2026-09-12",
});

describe("a payment plan at no interest", () => {
  it("uses the fewest months that keep each payment at the minimum, up to two years", () => {
    expect(planTerms(36_000)).toEqual({ months: 14, paymentCents: 2_572 });
    expect(planTerms(120_000)).toEqual({ months: 24, paymentCents: 5_000 });
    expect(planTerms(2_000)).toEqual({ months: 1, paymentCents: 2_000 });
  });
});

describe("the requests written for a bill", () => {
  it("always asks for an itemized bill, citing the right, with the bill's own amount and date", () => {
    const [itemized] = medicalItems(bill(18_000), false);
    expect(itemized.id).toBe("itemized:typed:b1");
    expect(itemized.body).toContain("$180.00 on Sep 12, 2026");
    expect(itemized.body).toContain(MEDICAL_RULES.itemized);
  });

  it("adds the insurance check only with a health plan on file", () => {
    expect(medicalItems(bill(18_000), false).map((i) => i.kind)).toEqual(["itemized"]);
    const withPlan = medicalItems(bill(18_000), true);
    expect(withPlan.map((i) => i.kind)).toEqual(["itemized", "insurance"]);
    expect(withPlan[1].body).toContain(MEDICAL_RULES.insurance);
  });

  it("adds a plan from $300 and financial assistance from $500, each citing its rule", () => {
    expect(medicalItems(bill(29_900), false).map((i) => i.kind)).toEqual(["itemized"]);
    const mid = medicalItems(bill(40_000), false);
    expect(mid.map((i) => i.kind)).toEqual(["itemized", "plan"]);
    expect(mid[1].body).toContain("16 equal monthly payments of $25.00 with no interest");
    expect(mid[1].body).toContain(MEDICAL_RULES.plan);
    const big = medicalItems(bill(250_000), true);
    expect(big.map((i) => i.kind)).toEqual(["itemized", "insurance", "assistance", "plan"]);
    expect(big[2].body).toContain(MEDICAL_RULES.assistance);
    expect(big[2].body).toContain("$2,500.00");
  });
});
