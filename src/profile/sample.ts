import { DEMO_FAMILY_CREDIT, demoToldFor } from "@/data-sources/demo/people-extras/told";
import { BENEFICIARY_SUBTYPES } from "@/config/family-file";
import { normalizeLiabilities } from "@/data-sources/plaid/liabilities";
import { demoAccounts, demoLiabilities, demoTransactions } from "@/data-sources/demo/demo-bank";
import { demoGoalsFor } from "@/data-sources/demo/demo-goals";
import { demoHoldings } from "@/data-sources/demo/demo-holdings";
import {
  DEMO_BENEFICIARIES_MISSING,
  DEMO_VALUES_EXCLUDES,
} from "@/data-sources/demo/people-extras/investing";
import { isPersonId, personById, type PersonId } from "@/config/people";
import { SAMPLE_RELIEF } from "@/config/disasters";
import { goalProgress } from "@/planning/goals";
import { tradeGoalOf } from "@/planning/goal-tradeoffs";
import type { NeedPolicy } from "@/lib/insurance/need/types";
import type { ProfileInput } from "./build";
import { samplePracticeIdeas } from "./sample-practice";

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

// What the daily books check (spec step 238) leaves open for the sample people: the Reyes
// family's savings comes in twice, once through each parent's bank login (the demo bank's
// second login, DEMO_SECOND_LOGINS), and the copies can't be proven the same. The words are
// the books check's own (src/lib/books.ts).
const SAMPLE_BOOKS: Readonly<Record<string, NonNullable<ProfileInput["extras"]>["books"]>> = {
  family: [
    {
      kind: "duplicate",
      words:
        "Demo Savings (ending 2002) looks like the same account linked twice, through two bank logins, but I can't prove the two copies match transaction for transaction, so I haven't merged them.",
      accountId: "demo-seedfamily-savings",
    },
  ],
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

function familyCreditFor(person: string): Pick<ProfileInput, "familyCredit"> {
  const rows = DEMO_FAMILY_CREDIT[person as PersonId] ?? [];
  if (rows.length === 0) return {};
  const cosigned = rows.filter((r) => r.kind === "cosigned");
  return {
    familyCredit: {
      helped: rows.length - cosigned.length,
      cosignedOwedCents: cosigned.reduce((s, r) => s + r.balanceCents, 0),
      cosignedMissed: cosigned.filter((r) => r.missed).length,
      cosignedPaymentCents: cosigned.reduce((s, r) => s + r.monthlyPaymentCents, 0),
    },
  };
}

export function inputFor(person: string, told: ProfileInput["told"] = {}): ProfileInput {
  const demo = { seed: `seed${person}`, anchor: SAMPLE_ANCHOR, person };
  const holdings = demoHoldings(demo, SAMPLE_TODAY);
  // Spec step 129: their investor profile comes with the demo bank (src/lib/plaid/demo.ts), so
  // their age and how they'd take a fall are told, as src/lib/profile.ts reads them.
  const investor = isPersonId(person) ? personById(person)?.investor : undefined;
  const input: ProfileInput = {
    today: SAMPLE_TODAY,
    // What they told Jane that no bank shows (people-extras/told.ts), their investor profile's
    // age and risk (spec step 129), then anything a test says.
    told: {
      ...demoToldFor(person, SAMPLE_TODAY),
      ...(investor ? { age: investor.age, risk: investor.dropReaction } : {}),
      ...told,
    },
    // Credit they help family with, as the profile loader totals it (src/lib/profile.ts).
    ...familyCreditFor(person),
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
    // What they've told Jane about values and beneficiaries (steps 236 and 237): the same lists
    // the demo bank seeds (people-extras/investing.ts).
    namedAccountIds: DEMO_BENEFICIARIES_MISSING.includes(person as PersonId)
      ? []
      : demoAccounts(demo)
          .filter((a) => BENEFICIARY_SUBTYPES.includes(a.subtype ?? ""))
          .map((a) => a.account_id),
    valuesExcludes: [...(DEMO_VALUES_EXCLUDES[person as PersonId] ?? [])],
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
    // Every liability the bank reports, normalised as a live sync does (cards' rates and
    // minimums included), so the harness sees what a linked person's profile sees (loans QA).
    liabilities: normalizeLiabilities(demoLiabilities(demo, SAMPLE_TODAY)).map((l) => ({
      accountId: l.accountRef,
      kind: l.kind,
      aprBps: l.aprBps,
      hasPmi: l.hasPmi,
      payoffDate: l.payoffDate,
      minimumCents: l.minimumPaymentCents,
    })),
  };
  // Phase AW: their practice portfolio starts by itself at the first scan
  // (src/lib/practice/demo-start.ts), with the ideas it has waiting.
  if (isPersonId(person)) {
    input.extras = {
      householdMembers: 0,
      ...input.extras,
      hasPracticePortfolio: true,
      practiceIdeas: samplePracticeIdeas(person, input),
    };
  }
  return input;
}
