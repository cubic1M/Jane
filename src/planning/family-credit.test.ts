import { describe, expect, it } from "vitest";
import { AUTHORIZED_USER, FILE_START } from "@/config/family-credit";
import {
  authorizedUser,
  cosignEffect,
  fileStartSavingCents,
  loanInterestCents,
  utilisation,
} from "./family-credit";

describe("an authorized user", () => {
  it("is low risk on a card used under 30% of its limit", () => {
    const v = authorizedUser({ balanceCents: 50_000, limitCents: 500_000 });
    expect(v.utilisation).toBe(0.1);
    expect(v.safe).toBe(true);
    expect(v.addedGainsPoints).toEqual(AUTHORIZED_USER.addedGainsPoints);
    expect(v.risk).toMatch(/history shows on both reports/);
  });

  it("is not safe on a card that runs high, or one with no limit", () => {
    expect(authorizedUser({ balanceCents: 300_000, limitCents: 500_000 }).safe).toBe(false);
    expect(authorizedUser({ balanceCents: 149_999, limitCents: 500_000 }).safe).toBe(true);
    expect(authorizedUser({ balanceCents: 150_000, limitCents: 500_000 }).safe).toBe(false);
    expect(authorizedUser({ balanceCents: 0, limitCents: null }).safe).toBe(false);
  });

  it("shows what the card's use would be if the added person spent on it", () => {
    const v = authorizedUser({ balanceCents: 100_000, limitCents: 500_000, spendCents: 200_000 });
    expect(v.afterSpend).toEqual({ spendCents: 200_000, utilisation: 0.6 });
    expect(authorizedUser({ balanceCents: 1, limitCents: 10 }).afterSpend).toBeNull();
  });

  it("has no use without a limit", () => {
    expect(utilisation(10, null)).toBeNull();
    expect(utilisation(10, 0)).toBeNull();
  });
});

describe("loan interest", () => {
  it("is zero at a zero rate and matches a known loan otherwise", () => {
    expect(loanInterestCents(120_000, 0, 12)).toBe(0);
    // $10,000 over 36 months at 6%: about $952 of interest.
    expect(loanInterestCents(1_000_000, 600, 36)).toBeGreaterThan(95_000);
    expect(loanInterestCents(1_000_000, 600, 36)).toBeLessThan(96_000);
  });
  it("makes starting a file worth the gap between the two stated rates", () => {
    const saving = fileStartSavingCents();
    expect(saving).toBeGreaterThan(0);
    expect(saving).toBe(
      loanInterestCents(
        FILE_START.firstLoanCents,
        FILE_START.thinFileAprBps,
        FILE_START.termMonths,
      ) -
        loanInterestCents(FILE_START.firstLoanCents, FILE_START.fairAprBps, FILE_START.termMonths),
    );
  });
});

describe("co-signing", () => {
  it("counts the co-signed payment in full in the person's own debt-to-income", () => {
    const v = cosignEffect({
      incomeCents: 500_000,
      paymentsCents: 100_000,
      cosigned: [{ balanceCents: 1_200_000, monthlyPaymentCents: 30_000 }],
    });
    expect(v.shareBefore).toBeCloseTo(0.2);
    expect(v.shareWith).toBeCloseTo(0.26);
    expect(v.cosignedPaymentCents).toBe(30_000);
    expect(v.exposureCents).toBe(1_200_000);
    expect(v.ifMissed).toEqual({ balanceCents: 1_200_000, paymentCents: 30_000 });
  });

  it("adds several loans and copes with amounts left out and with no income", () => {
    const v = cosignEffect({
      incomeCents: null,
      paymentsCents: 100_000,
      cosigned: [
        { balanceCents: 100_000, monthlyPaymentCents: null },
        { balanceCents: null, monthlyPaymentCents: 5_000 },
      ],
    });
    expect(v.shareBefore).toBeNull();
    expect(v.shareWith).toBeNull();
    expect(v.exposureCents).toBe(100_000);
    expect(v.cosignedPaymentCents).toBe(5_000);
    expect(cosignEffect({ incomeCents: 1, paymentsCents: 0, cosigned: [] }).exposureCents).toBe(0);
  });
});
