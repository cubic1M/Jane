import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { fplFor } from "@/config/health-taxes";
import { ptcCheck } from "@/planning/health-taxes";
import { readHealthTaxes } from "@/planning/health-taxes-read";
import { healthReply } from "./health-tax-message";

// CodeRabbit sweep 1d (#2273): a year whose repayment limit isn't on file says so; it does not
// say the credit "covers" the advance, as it would for a repayment of $0.
describe("the Marketplace credit message for a year with no repayment limit on file", () => {
  it("says it can't tell how much would be repaid", () => {
    const d = inputFor("equity");
    const view = readHealthTaxes(buildProfile(d), d);
    const check = ptcCheck({
      year: 2024,
      incomeCents: Math.round(fplFor(1) * 3.9),
      householdSize: 1,
      benchmarkYearCents: 200_000,
      advanceYearCents: 900_000,
    });
    const body = healthReply({
      ...view,
      marketplace: { ...view.marketplace, check, payments: 1 },
    } as never).body;
    expect(body).toMatch(/can't say how much would be repaid/);
    expect(body).not.toMatch(/covers the/);
  });
});
