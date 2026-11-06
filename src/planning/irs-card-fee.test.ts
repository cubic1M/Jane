import { describe, expect, it } from "vitest";
import { IRS_CARD_PAYMENTS } from "@/config/tax";
import { recommendsAChoice } from "@/lib/guardrails";
import { irsCardFee } from "./irs-card-fee";

// Connectors roadmap round 16: the card fee next to the card's rewards.

describe("irsCardFee", () => {
  it("charges a credit card the percent, never under the minimum, cheaper processor first", () => {
    const check = irsCardFee({ amountCents: 500_000, card: "credit", rewardsBps: 200 });
    // $5,000: Pay1040 1.75% = $87.50, ACI 1.85% = $92.50.
    expect(check.fees).toEqual([
      { processor: "Pay1040", feeCents: 8_750 },
      { processor: "ACI Payments", feeCents: 9_250 },
    ]);
    // 2% back is $100: $12.50 ahead of the lower fee.
    expect(check.rewardsCents).toBe(10_000);
    expect(check.netCents).toBe(1_250);
    expect(check.lines[1]).toContain("$12.50 ahead");
    expect(
      irsCardFee({ amountCents: 5_000, card: "credit", rewardsBps: 0 }).fees[0]!.feeCents,
    ).toBe(250);
  });

  it("charges a debit card the flat fee, and says when the rewards don't cover it", () => {
    const check = irsCardFee({ amountCents: 500_000, card: "debit", rewardsBps: 0 });
    expect(check.fees.map((f) => f.feeCents)).toEqual([210, 215]);
    expect(check.netCents).toBe(-210);
    expect(check.lines[1]).toContain("fee is the whole cost");
    const behind = irsCardFee({ amountCents: 500_000, card: "credit", rewardsBps: 100 });
    expect(behind.lines[1]).toContain("$37.50 behind");
  });

  it("says Direct Pay is free, the card limit for estimated tax, and the fees' date, without picking", () => {
    const { lines } = irsCardFee({ amountCents: 100_000, card: "credit", rewardsBps: 150 });
    expect(lines.join(" ")).toContain("IRS Direct Pay costs nothing");
    expect(lines.join(" ")).toContain(
      `at most ${IRS_CARD_PAYMENTS.estimatedPerQuarter} times a quarter`,
    );
    expect(lines[0]).toContain(`as of ${IRS_CARD_PAYMENTS.asOf}`);
    expect(recommendsAChoice(lines.join(" "))).toBe(false);
    expect(IRS_CARD_PAYMENTS.source).toMatch(/^https:\/\/www\.irs\.gov\//);
  });
});
