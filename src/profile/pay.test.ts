import { describe, expect, it } from "vitest";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { buildProfile } from "./build";
import { personalPay } from "./pay";
import { inputFor } from "./sample";

// Books QA: a business owner's sales aren't their pay.
describe("personal pay", () => {
  it("takes a business owner's pay as the profit share of their sales, and says so", () => {
    const profile = buildProfile(inputFor("owner"));
    const sales = profile.facts.monthly_income.value as number;
    expect(personalPay(profile)).toEqual({
      monthlyCents: Math.round(sales * R.tax.businessProfitShare),
      assumedShare: R.tax.businessProfitShare,
    });
  });

  it("uses what an owner told Jane they take home, and a wage as it is", () => {
    expect(personalPay(buildProfile(inputFor("owner", { monthly_income: 600_000 })))).toEqual({
      monthlyCents: 600_000,
      assumedShare: null,
    });
    const renter = buildProfile(inputFor("renter"));
    expect(personalPay(renter)).toEqual({
      monthlyCents: renter.facts.monthly_income.value,
      assumedShare: null,
    });
  });
});
