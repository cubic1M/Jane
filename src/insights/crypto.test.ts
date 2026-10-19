import { describe, expect, it } from "vitest";
import { CRYPTO_FEE_FLAG_BPS, CRYPTO_SHARE_FLAG } from "@/config/crypto";
import { cryptoFees, cryptoSize, isStale } from "./crypto";

// Spec step 161: crypto sized against everything invested, and its exchange's fees.

describe("cryptoSize", () => {
  it("is the share of everything invested, crypto included, with the gain", () => {
    const size = cryptoSize(
      [
        { valueCents: 600_000, costBasisCents: 500_000 },
        { valueCents: 200_000, costBasisCents: 250_000 },
      ],
      9_200_000,
    );
    expect(size).toEqual({ totalCents: 800_000, share: 0.08, overShare: true, gainCents: 50_000 });
  });
  it("isn't flagged at or under the rule of thumb, and has no gain without every basis", () => {
    expect(CRYPTO_SHARE_FLAG).toBe(0.05);
    const at = cryptoSize([{ valueCents: 50_000, costBasisCents: null }], 950_000);
    expect(at).toMatchObject({ share: 0.05, overShare: false, gainCents: null });
    expect(cryptoSize([], 0)).toEqual({
      totalCents: 0,
      share: 0,
      overShare: false,
      gainCents: null,
    });
  });
});

describe("cryptoFees", () => {
  it("flags fees above 1% of what was traded, with what a low-cost exchange would charge", () => {
    // The demo exchange: 12 buys of $150 with a $2.24 fee each.
    const fees = cryptoFees(2_688, 180_000);
    expect(fees).toEqual({
      feesCents: 2_688,
      tradedCents: 180_000,
      bps: 149,
      flag: true,
      lowCostCents: { lowCents: 180, highCents: 1_080 },
    });
    expect(CRYPTO_FEE_FLAG_BPS).toBe(100);
    expect(cryptoFees(1_800, 180_000).flag).toBe(false);
    expect(cryptoFees(0, 0)).toMatchObject({ bps: null, flag: false });
  });
});

describe("isStale", () => {
  it("labels a balance read more than 36 hours ago", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(isStale(new Date("2026-10-18T12:00:00Z"), now)).toBe(false);
    expect(isStale(new Date("2026-10-17T23:00:00Z"), now)).toBe(true);
  });
});
