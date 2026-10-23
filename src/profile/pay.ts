import { DETECTOR_RATES as R } from "@/config/detectors";
import type { Profile } from "./build";

// What a person takes home a month, for sizing what replaces their pay (disability and life
// cover). A business owner's deposits are the business's sales, not pay: until they say what they
// pay themselves, their pay is the profit share of those sales (an estimate, and said as one).
// Pure.
export function personalPay(profile: Profile): {
  monthlyCents: number | null;
  // The share of sales assumed to be profit, when the pay is that estimate.
  assumedShare: number | null;
} {
  const income = profile.facts.monthly_income;
  if (typeof income.value !== "number" || income.value <= 0)
    return { monthlyCents: null, assumedShare: null };
  if (profile.facts.income_pattern.value === "business" && income.source !== "told") {
    const share = R.tax.businessProfitShare;
    return { monthlyCents: Math.round(income.value * share), assumedShare: share };
  }
  return { monthlyCents: income.value, assumedShare: null };
}
