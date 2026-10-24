import type { Profile, ProfileInput } from "@/profile/build";
import { BUSINESS_SALES_DEPOSIT } from "@/config/insurance";
import type { SelfEmployment } from "@/lib/insurance/business-rules";
import { personalPay } from "@/profile/pay";
import type { NeedInput } from "./types";

// The need calculators' input from a person's profile (spec step 277), so a detector, the chat
// and the page work from the same numbers: pay from the profile's income, debts and savings from
// the accounts, dependants from whether there are children. Null when the policies weren't
// loaded. Pure.

const yearsUntil = (today: string, day: string) =>
  (Date.parse(day) - Date.parse(today)) / (365.25 * 86_400_000);

// Spec step 201: what the profile's transactions say about a business or side work, over the
// months the profile covers (the tax profile's mileage isn't in it, so no miles).
export function selfEmploymentFrom(profile: Profile, data: ProfileInput): SelfEmployment {
  const sum = (f: (t: ProfileInput["transactions"][number]) => boolean) =>
    data.transactions.filter(f).reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const months = Math.max(1, profile.months);
  return {
    declared: profile.facts.income_pattern.value === "business",
    serviceCents: sum((t) => t.pfc === "INCOME_CONTRACTOR" && t.amountCents < 0),
    gigCents: sum((t) => t.pfc === "INCOME_GIG_ECONOMY" && t.amountCents < 0),
    salesCents: sum(
      (t) =>
        t.pfc === "INCOME_OTHER" && t.amountCents < 0 && BUSINESS_SALES_DEPOSIT.test(t.description),
    ),
    miles: 0,
    equipmentCents: sum((t) => t.pfc === "GENERAL_MERCHANDISE_ELECTRONICS" && t.amountCents > 0),
    payments: data.transactions.filter(
      (t) =>
        t.amountCents < 0 &&
        (t.pfc === "INCOME_CONTRACTOR" ||
          t.pfc === "INCOME_GIG_ECONOMY" ||
          (t.pfc === "INCOME_OTHER" && BUSINESS_SALES_DEPOSIT.test(t.description))),
    ).length,
    gasMonthlyCents: Math.round(
      sum((t) => t.pfc === "TRANSPORTATION_GAS" && t.amountCents > 0) / months,
    ),
  };
}

export function needInputFromProfile(profile: Profile, data: ProfileInput): NeedInput | null {
  const policies = data.extras?.coverPolicies;
  if (!policies) return null;
  const sum = (f: (a: ProfileInput["accounts"][number]) => boolean) =>
    data.accounts.filter(f).reduce((s, a) => s + a.balanceCents, 0);
  // What they take home: a business owner's sales aren't pay (books QA).
  const pay = personalPay(profile).monthlyCents;
  const mortgage = sum((a) => a.subtype === "mortgage");
  const otherDebt = sum(
    (a) => (a.type === "loan" && a.subtype !== "mortgage") || a.type === "credit",
  );
  const assets =
    sum((a) => a.type === "depository" || a.type === "investment") +
    (data.extras?.ownedValueCents ?? 0);
  const payoff = data.liabilities.find((l) => l.kind === "mortgage")?.payoffDate ?? null;
  return {
    yearlyPayCents: pay !== null ? pay * 12 : null,
    // The profile knows whether there are children, not how many: at least one depends on them.
    dependants: profile.facts.has_children.value === true ? 1 : 0,
    mortgageCents: mortgage,
    otherDebtCents: otherDebt,
    mortgageYearsLeft: payoff ? Math.max(0, Math.round(yearsUntil(data.today, payoff))) : null,
    savingsCents: sum((a) => a.type === "depository" && a.subtype === "savings"),
    cashCents: sum((a) => a.type === "depository"),
    netWorthCents: assets - mortgage - otherDebt,
    workLifeCoverCents: 0,
    policies,
    business: selfEmploymentFrom(profile, data),
  };
}
