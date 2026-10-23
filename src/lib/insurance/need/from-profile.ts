import type { Profile, ProfileInput } from "@/profile/build";
import { personalPay } from "@/profile/pay";
import type { NeedInput } from "./types";

// The need calculators' input from a person's profile (spec step 277), so a detector, the chat
// and the page work from the same numbers: pay from the profile's income, debts and savings from
// the accounts, dependants from whether there are children. Null when the policies weren't
// loaded. Pure.

const yearsUntil = (today: string, day: string) =>
  (Date.parse(day) - Date.parse(today)) / (365.25 * 86_400_000);

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
  };
}
