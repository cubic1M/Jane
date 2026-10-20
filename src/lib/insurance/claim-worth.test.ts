import { describe, expect, it } from "vitest";
import { CLAIM_SURCHARGE, POLICY_KINDS, type PolicyKind } from "@/config/insurance";
import { adviceLines, claimWorth, payoutLine } from "./claim-worth";

// Claim or pay yourself? (spec step 199).

const kinds = Object.keys(POLICY_KINDS) as PolicyKind[];

describe("claimWorth", () => {
  it("has a three-year figure for every kind of policy", () => {
    for (const kind of kinds) {
      expect(CLAIM_SURCHARGE[kind], kind).toBeDefined();
      const w = claimWorth({
        kind,
        estimateCents: 300_000,
        deductibleCents: 50_000,
        yearlyPremiumCents: 200_000,
      });
      expect(w.riseCents, kind).toBe(Math.round(200_000 * CLAIM_SURCHARGE[kind].default * 3));
      expect(w.payoutCents).toBe(250_000);
    }
  });

  it("says a small claim under the deductible pays nothing", () => {
    const w = claimWorth({
      kind: "auto",
      estimateCents: 60_000,
      deductibleCents: 100_000,
      yearlyPremiumCents: 170_000,
    });
    expect(w.underDeductible).toBe(true);
    expect(w.payoutCents).toBe(0);
    expect(w.verdict).toBe("pay_yourself");
    expect(payoutLine(w)).toMatch(/under your \$1,000\.00 deductible.*pay nothing/);
  });

  it("weighs the payout against the rise and the lost discount", () => {
    const claim = claimWorth({
      kind: "auto",
      event: "accident",
      estimateCents: 1_200_000,
      deductibleCents: 100_000,
      yearlyPremiumCents: 170_000,
    });
    expect(claim.verdict).toBe("claim");
    const small = claimWorth({
      kind: "auto",
      event: "accident",
      estimateCents: 150_000,
      deductibleCents: 100_000,
      yearlyPremiumCents: 170_000,
    });
    expect(small.netCents).toBeLessThan(0);
    expect(small.verdict).toBe("pay_yourself");
    expect(adviceLines(small).join(" ")).toMatch(/paying it yourself looks cheaper/);
  });

  it("has no verdict without the premium, and says what it needs without a deductible", () => {
    const w = claimWorth({
      kind: "home",
      estimateCents: 500_000,
      deductibleCents: null,
      yearlyPremiumCents: null,
    });
    expect(w.verdict).toBe("unknown");
    expect(adviceLines(w)).toEqual([]);
    expect(payoutLine(w)).toMatch(/need your deductible/);
  });
});
