import { DETECTOR_RATES as R } from "@/config/detectors";
import { FSA_DEADLINE, HEALTH_PLAN_EXCLUDED_CATEGORIES } from "@/config/insurance";
import { formatCents } from "@/lib/money";
import {
  disputes,
  fsaStatus,
  networkOf,
  planBills,
  progress,
  type Bill,
} from "@/lib/insurance/health-year-rules";
import { DEMO_NETWORK_DIRECTORY } from "@/config/insurance";
import type { ProfileInput } from "@/profile/build";
import { type Confidence, type Detector, suggestionId } from "./contract";
import { evidence, headlineOf } from "./helpers";

// Detectors for the health plan's year (spec step 259): the FSA money that will be lost, a
// deductible already met before the year resets, and a medical bill above what the plan should
// have paid. They use the plan's terms where Jane has them (a confirmed policy, the pay stub's
// FSA), from the same rules as /insurance (src/lib/insurance/health-year-rules.ts). Pure.

const CAPS = R.insuranceCaps;
const plain = (name: string) => name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function capped(c: Confidence, max: number, note: string): Confidence {
  return c.percent <= max ? c : { percent: max, reason: `${c.reason}; ${note}` };
}

// Medical bills this calendar year (and last, for a dispute), from the transactions.
function billsOf(data: ProfileInput, years: readonly string[]): Bill[] {
  return data.transactions
    .filter(
      (t) =>
        t.amountCents > 0 &&
        (t.pfc ?? "").startsWith("MEDICAL_") &&
        years.some((y) => t.date.startsWith(y)),
    )
    .map((t, i) => ({
      id: `${t.date}-${i}`,
      date: t.date,
      provider: t.description,
      cents: t.amountCents,
      category: t.pfc,
    }));
}

const thisYear = (today: string) => today.slice(0, 4);

const fsaDeadline: Detector = {
  capability: "insurance",
  covers: ["insurance_health_year"],
  topic: "fsa_deadline",
  needs: [],
  detect({ profile, data }) {
    const election = data.fsaElectionCents;
    const plan = data.healthPlan;
    if (!election || !plan) return null;
    const bills = billsOf(data, [thisYear(profile.today)]);
    const plans = planBills(bills);
    const p = progress(
      { ...plan, outOfPocketMaxCents: plan.outOfPocketMaxCents },
      plans,
      profile.today,
    );
    const excluded = bills
      .filter((b) => b.category && HEALTH_PLAN_EXCLUDED_CATEGORIES.includes(b.category))
      .reduce((n, b) => n + b.cents, 0);
    const status = fsaStatus(election, p.oopSoFarCents + excluded, profile.today);
    if (!status.warn) return null;
    const urgency =
      status.daysLeft <= R.fsaNowDays ? "now" : status.daysLeft <= R.fsaSoonDays ? "soon" : "later";
    return {
      id: suggestionId("insurance", "fsa_deadline"),
      capability: "insurance",
      topic: "fsa_deadline",
      title: "Use your FSA money before it expires",
      headline: headlineOf("Use your FSA money", status.leftCents, "saves", true),
      short: `About ${formatCents(status.leftCents)} of your FSA is left, lost in ${status.daysLeft} days.`,
      worthCents: status.leftCents,
      worthKind: "saves",
      confidence: capped(
        evidence("seen", profile.months, bills.length, "medical charges"),
        CAPS.fsaDeadline,
        "I can't see your FSA claims, so what's left is an estimate",
      ),
      urgency,
      why: `You set aside ${formatCents(election)} for your FSA this year and your medical costs come to about ${formatCents(status.usedCents)}, so around ${formatCents(status.leftCents)} is left. It's lost after Dec ${FSA_DEADLINE.day} (${status.daysLeft} days), unless your employer allows a carryover. Eligible care, prescriptions, glasses and dental work count.`,
      action: { label: "Your health year", href: "/insurance#health-year" },
    };
  },
};

const deductibleMet: Detector = {
  capability: "insurance",
  covers: ["insurance_health_year"],
  topic: "deductible_met",
  needs: [],
  detect({ profile, data }) {
    const plan = data.healthPlan;
    if (!plan || plan.deductibleCents <= 0) return null;
    const month = Number(profile.today.slice(5, 7));
    if (month < R.deductibleMetFromMonth) return null;
    const plans = planBills(billsOf(data, [thisYear(profile.today)]));
    const p = progress(plan, plans, profile.today);
    if (p.deductibleLeftCents > 0) return null;
    const saves = Math.round((R.plannedCareCents * (100 - plan.coinsurance)) / 100);
    return {
      id: suggestionId("insurance", "deductible_met"),
      capability: "insurance",
      topic: "deductible_met",
      title: "Book planned care before the year resets",
      headline: headlineOf("Get planned care before January", saves, "saves", true),
      short: `You've met your ${formatCents(plan.deductibleCents)} deductible; your plan pays ${100 - plan.coinsurance}% until Dec 31.`,
      worthCents: saves,
      worthKind: "saves",
      confidence: capped(
        evidence("seen", profile.months, plans.length, "medical charges"),
        CAPS.deductibleMet,
        "I don't know if you have care planned",
      ),
      urgency: "soon",
      why: `You've paid your whole ${formatCents(plan.deductibleCents)} deductible this year. Until Dec 31 your plan pays ${100 - plan.coinsurance}% of covered care; in January you'd pay the deductible again. A planned visit or procedure now costs about ${formatCents(saves)} less on a ${formatCents(R.plannedCareCents)} bill.`,
      action: { label: "Your health year", href: "/insurance#health-year" },
    };
  },
};

const medicalBillDispute: Detector = {
  capability: "insurance",
  covers: ["insurance_health_year"],
  topic: "medical_bill_dispute",
  needs: [],
  detect({ profile, data }) {
    const plan = data.healthPlan;
    if (!plan) return null;
    const year = Number(thisYear(profile.today));
    const found = [year - 1, year].flatMap((y) =>
      disputes(plan, planBills(billsOf(data, [String(y)])), (b) =>
        networkOf(b.provider, DEMO_NETWORK_DIRECTORY),
      ),
    );
    if (found.length === 0) return null;
    const top = found.reduce((a, b) => (b.overCents > a.overCents ? b : a));
    return {
      id: suggestionId("insurance", "medical_bill_dispute"),
      capability: "insurance",
      topic: "medical_bill_dispute",
      title: "Ask the team to check this medical bill",
      headline: headlineOf("Ask us to check a medical bill", top.overCents, "saves", true),
      short: `${plain(top.bill.provider)} billed ${formatCents(top.paidCents)}; your share looks like ${formatCents(top.shouldPayCents)}.`,
      worthCents: top.overCents,
      worthKind: "saves",
      confidence: capped(
        evidence("seen", profile.months, found.length, "bills above the plan's share"),
        CAPS.billDispute,
        "your plan's share is worked out from its terms, not the insurer's statement",
      ),
      urgency: "soon",
      why: `${plain(top.bill.provider)} billed ${formatCents(top.paidCents)} on ${top.bill.date}. By your plan's terms your share looks like about ${formatCents(top.shouldPayCents)}, which is ${formatCents(top.overCents)} less. My team can ask the provider and your plan to check it.`,
      action: { label: "Your health year", href: "/insurance#health-year" },
    };
  },
};

export const HEALTH_YEAR_DETECTORS: readonly Detector[] = [
  fsaDeadline,
  deductibleMet,
  medicalBillDispute,
];
