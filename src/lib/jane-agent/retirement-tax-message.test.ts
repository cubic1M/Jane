import { describe, expect, it } from "vitest";
import type { RetirementTaxView } from "@/lib/retirement-taxes";
import { retirementReply } from "./retirement-tax-message";

// Someone years from Medicare, with no Social Security yet.
const young = {
  ssBenefitsCents: 0,
  nearMedicare: false,
  advice: false,
  magiCents: 9_000_000,
  balances: { preTaxCents: 0 },
  irmaa: { premiumYear: 2028, tier: 0, nextLineCents: null, roomCents: null, estimated: true },
} as unknown as RetirementTaxView;

describe("the retirement tax answer", () => {
  it("says what IRMAA is when asked by name, years before Medicare", () => {
    expect(retirementReply(young, { medicare: true }).body).toContain(
      "Medicare's surcharge (IRMAA): once you're on Medicare",
    );
  });

  it("leaves Medicare out for someone years away who didn't ask", () => {
    expect(retirementReply(young).body).not.toMatch(/Medicare/);
  });
});
