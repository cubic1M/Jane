import { demoAccounts, demoLiabilities, demoTransactions } from "@/data-sources/demo/demo-bank";
import { demoHoldings } from "@/data-sources/demo/demo-holdings";
import type { NeedPolicy } from "@/lib/insurance/need/types";
import type { ProfileInput } from "./build";

// A sample person's data in the shape the profile builder takes, straight from the demo bank
// (spec step 252), so the profile and the detector harness (steps 253 and 254) can be tried
// on all eight without a database. Pure.

export const SAMPLE_ANCHOR = "2026-10-18";
export const SAMPLE_TODAY = "2026-10-17";

// Sample people with an uploaded policy document not yet confirmed (spec step 259): Ruth sent
// in her Medicare supplement's renewal notice.
const UNREAD_DOCUMENTS: Readonly<Record<string, number>> = { retiree: 1 };

// The policies the sample people have, for the cover-need gaps (spec step 277): the ones their
// charges show (State Farm, AAA, Chubb, Allstate, Progressive), with plausible limits.
const car = (id: string, person: number, accident: number, deductible: number): NeedPolicy => ({
  id,
  kind: "auto",
  status: "active",
  deductibleCents: deductible,
  coverage: { bodilyInjuryPerPerson: person, bodilyInjuryPerAccident: accident, collision: true },
});
const house = (id: string, liability: number, deductible: number): NeedPolicy => ({
  id,
  kind: "home",
  status: "active",
  deductibleCents: deductible,
  coverage: { dwelling: 40_000_000, liability },
});
const SAMPLE_POLICIES: Readonly<Record<string, readonly NeedPolicy[]>> = {
  renter: [car("renter-auto", 5_000_000, 10_000_000, 100_000)],
  family: [
    car("family-auto", 5_000_000, 10_000_000, 50_000),
    house("family-home", 10_000_000, 100_000),
  ],
  equity: [house("equity-home", 30_000_000, 100_000)],
  preretire: [
    car("pre-auto", 25_000_000, 50_000_000, 100_000),
    house("pre-home", 30_000_000, 100_000),
  ],
  retiree: [house("retiree-home", 30_000_000, 100_000)],
};

// Sample people with a health plan whose terms Jane has, and an FSA election (spec step 259).
const HEALTH_PLANS: Readonly<
  Record<string, { plan: NonNullable<ProfileInput["healthPlan"]>; fsaElectionCents: number | null }>
> = {
  family: {
    plan: {
      label: "Acme PPO",
      deductibleCents: 150_000,
      outOfPocketMaxCents: 450_000,
      coinsurance: 20,
    },
    fsaElectionCents: 240_000,
  },
};

export function inputFor(person: string, told: ProfileInput["told"] = {}): ProfileInput {
  const demo = { seed: `seed${person}`, anchor: SAMPLE_ANCHOR, person };
  const holdings = demoHoldings(demo, SAMPLE_TODAY);
  return {
    today: SAMPLE_TODAY,
    told,
    extras: { householdMembers: 0, coverPolicies: SAMPLE_POLICIES[person] ?? [] },
    unreadPolicyDocuments: UNREAD_DOCUMENTS[person] ?? 0,
    healthPlan: HEALTH_PLANS[person]?.plan ?? null,
    fsaElectionCents: HEALTH_PLANS[person]?.fsaElectionCents ?? null,
    holdings: holdings.map((h) => ({
      ticker:
        h.security_id.replace("demo-sec-", "").toUpperCase() === "CASH"
          ? null
          : h.security_id.replace("demo-sec-", "").toUpperCase(),
      isCash: h.security_id === "demo-sec-cash",
      accountId: h.account_id,
      valueCents: Math.round(h.institution_value * 100),
      basisCents: h.cost_basis == null ? null : Math.round(h.cost_basis * 100),
    })),
    transactions: demoTransactions(demo, null, SAMPLE_TODAY).map((t) => ({
      date: t.date,
      amountCents: Math.round(t.amount * 100),
      description: t.name,
      pfc: t.personal_finance_category?.detailed ?? null,
      accountId: t.account_id,
    })),
    accounts: demoAccounts(demo).map((a) => ({
      id: a.account_id,
      type: a.type,
      subtype: a.subtype,
      balanceCents:
        a.type === "investment"
          ? holdings
              .filter((h) => h.account_id === a.account_id)
              .reduce((s, h) => s + Math.round(h.institution_value * 100), 0)
          : Math.round((a.balances.current ?? 0) * 100),
      limitCents: a.balances.limit != null ? Math.round(a.balances.limit * 100) : null,
    })),
    liabilities: [
      ...(demoLiabilities(demo, SAMPLE_TODAY).mortgage ?? []).map((m) => ({
        accountId: m.account_id,
        kind: "mortgage",
        aprBps: Math.round((m.interest_rate.percentage ?? 0) * 100),
        hasPmi: m.has_pmi,
        payoffDate: m.maturity_date ?? null,
      })),
    ],
  };
}
