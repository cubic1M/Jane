import { BENEFICIARY_SUBTYPES } from "@/config/family-file";
import { demoAccounts, demoLiabilities, demoTransactions } from "@/data-sources/demo/demo-bank";
import { demoGoalsFor } from "@/data-sources/demo/demo-goals";
import { demoHoldings } from "@/data-sources/demo/demo-holdings";
import { SAMPLE_RELIEF } from "@/config/disasters";
import { goalProgress } from "@/planning/goals";
import { tradeGoalOf } from "@/planning/goal-tradeoffs";
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
const house = (
  id: string,
  liability: number,
  deductible: number,
  dwelling = 40_000_000,
): NeedPolicy => ({
  id,
  kind: "home",
  status: "active",
  deductibleCents: deductible,
  coverage: { dwelling, liability },
});
const SAMPLE_POLICIES: Readonly<Record<string, readonly NeedPolicy[]>> = {
  renter: [car("renter-auto", 5_000_000, 10_000_000, 100_000)],
  family: [
    car("family-auto", 5_000_000, 10_000_000, 50_000),
    house("family-home", 10_000_000, 100_000),
  ],
  // Their mortgage is about $910,000, so the home is worth well over that.
  equity: [house("equity-home", 30_000_000, 100_000, 150_000_000)],
  preretire: [
    car("pre-auto", 25_000_000, 50_000_000, 100_000),
    house("pre-home", 30_000_000, 100_000),
  ],
  retiree: [house("retiree-home", 30_000_000, 100_000)],
};

// What the daily books check (spec step 238) left open for the sample people: the Reyes family's
// joint savings is linked twice, once through each parent's bank login.
const SAMPLE_BOOKS: Readonly<Record<string, NonNullable<ProfileInput["extras"]>["books"]>> = {
  family: [
    {
      kind: "duplicate",
      words: "Your joint savings is linked twice, once through each of your bank logins.",
      accountId: "demo-seedfamily-savings",
    },
  ],
};

export function inputFor(person: string, told: ProfileInput["told"] = {}): ProfileInput {
  const demo = { seed: `seed${person}`, anchor: SAMPLE_ANCHOR, person };
  const holdings = demoHoldings(demo, SAMPLE_TODAY);
  return {
    today: SAMPLE_TODAY,
    told,
    extras: {
      householdMembers: 0,
      coverPolicies: SAMPLE_POLICIES[person] ?? [],
      books: SAMPLE_BOOKS[person] ?? [],
      // The sample people are all the demo bank's, so they read the stand-in disaster feed.
      disasterRelief: SAMPLE_RELIEF,
      // A home is worth about what its policy insures the dwelling for (the demo bank's owned things).
      ownedValueCents: (SAMPLE_POLICIES[person] ?? [])
        .filter((p) => p.kind === "home")
        .reduce((sum, p) => sum + Number(p.coverage.dwelling ?? 0), 0),
      // Spec step 241: their goals as the demo bank adds them on the day it's linked.
      goals: demoGoalsFor(person, SAMPLE_TODAY).flatMap(
        (g, i) =>
          tradeGoalOf({
            id: `${person}-goal-${i}`,
            name: g.name,
            targetDate: g.targetDate,
            progress: goalProgress(
              { targetCents: g.targetCents, savedCents: g.savedCents, targetDate: g.targetDate },
              SAMPLE_TODAY,
            ),
          }) ?? [],
      ),
    },
    unreadPolicyDocuments: UNREAD_DOCUMENTS[person] ?? 0,
    // Priya has asked Jane to keep fossil fuels out of her funds (spec step 236).
    // Everyone has named beneficiaries except the family (a new child) and the couple near
    // retirement (a form from years ago), spec step 237.
    namedAccountIds: ["family", "preretire"].includes(person)
      ? []
      : demoAccounts(demo)
          .filter((a) => BENEFICIARY_SUBTYPES.includes(a.subtype ?? ""))
          .map((a) => a.account_id),
    valuesExcludes: person === "equity" ? ["fossil_fuels"] : [],
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
      name: a.name,
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
