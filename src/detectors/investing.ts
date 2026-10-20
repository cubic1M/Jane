import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, weakest } from "./helpers";

// Detectors for the investing capability (spec step 262; inventory in
// docs/detectors/investing.md): the match left on the table, catch-up contributions, an HSA
// sitting idle, the backdoor Roth, a 529 for the kids, and required withdrawals. Pure; see
// ./contract.ts. Anything that amounts to advice still reaches the person through adviceMode
// and the guardrails when it is shown in the chat; these only say who it applies to.

const sum = (list: { balanceCents: number }[]) => list.reduce((s, a) => s + a.balanceCents, 0);
const annual = (monthly: unknown) => (typeof monthly === "number" ? monthly * 12 : 0);

const employerMatch: Detector = {
  capability: "investing",
  topic: "employer_match",
  covers: ["retirement_plan", "account_plan"],
  needs: ["income_pattern", "has_401k", "monthly_income"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const has = profile.facts.has_401k;
    const income = profile.facts.monthly_income;
    const stage = profile.facts.life_stage;
    if (pattern.value !== "salary" || has.value !== true) return null;
    if (stage.value === "approaching" || stage.value === "retired") return null;
    const pay = annual(income.value);
    const saved = sum(data.accounts.filter((a) => a.subtype === "401k"));
    if (pay === 0 || saved >= pay * R.matchHealthyShare) return null;
    const match = Math.round(pay * R.matchTypicalShare);
    return {
      id: suggestionId("investing", "employer_match"),
      capability: "investing",
      topic: "employer_match",
      title: "Make sure you get your employer's full 401(k) match",
      worthCents: match,
      worthKind: "earns",
      confidence: weakest([
        factEvidence(has),
        factEvidence(income),
        evidence("seen", profile.months, 1, "401(k) account"),
        { percent: 75, reason: "whether and how much your employer matches is a guess" },
      ]),
      urgency: "soon",
      why: `Your 401(k) holds ${formatCents(saved)} against pay of about ${formatCents(pay)} a year. A typical match is ${Math.round(R.matchTypicalShare * 100)}% of pay, about ${formatCents(match)} a year, and it is lost if you don't contribute enough to get it.`,
      action: { label: "Check your match", href: "/investments/retirement-accounts" },
    };
  },
};

const catchUp: Detector = {
  capability: "investing",
  topic: "catch_up",
  covers: ["retirement_plan"],
  needs: ["life_stage", "has_401k"],
  detect({ profile }) {
    const stage = profile.facts.life_stage;
    const has = profile.facts.has_401k;
    if (stage.value !== "approaching" || has.value !== true) return null;
    return {
      id: suggestionId("investing", "catch_up"),
      capability: "investing",
      topic: "catch_up",
      title: "Use the catch-up contribution for people over 50",
      worthCents: Math.round(R.catchUpCents * R.selfRetireTaxRate),
      worthKind: "saves",
      confidence: weakest([
        { percent: stage.confidence, reason: "your age is a guess from your accounts and income" },
        factEvidence(has),
      ]),
      urgency: "soon",
      why: `You are close to retirement and have a 401(k). People over 50 can put in about ${formatCents(R.catchUpCents)} more a year, if you are not already using it, which at a ${Math.round(R.selfRetireTaxRate * 100)}% tax rate cuts the tax bill by about ${formatCents(Math.round(R.catchUpCents * R.selfRetireTaxRate))}.`,
      action: { label: "See your limits", href: "/investments/retirement-accounts" },
    };
  },
};

const hsaIdle: Detector = {
  capability: "investing",
  topic: "hsa",
  covers: ["hsa"],
  needs: ["has_hsa"],
  detect({ profile, data }) {
    const has = profile.facts.has_hsa;
    if (has.value !== true) return null;
    const balance = sum(data.accounts.filter((a) => a.subtype === "hsa"));
    if (balance < R.hsaMinCents) return null;
    return {
      id: suggestionId("investing", "hsa"),
      capability: "investing",
      topic: "hsa",
      title: "Put your HSA money to work",
      worthCents: Math.round((balance * (R.highYieldBps - R.currentCashBps)) / 10_000),
      worthKind: "earns",
      confidence: weakest([factEvidence(has), evidence("seen", profile.months, 1, "HSA balance")]),
      urgency: "later",
      why: `Your HSA holds ${formatCents(balance)}. Money you won't spend on medical bills this year can earn more than a cash balance, and growth in an HSA is tax free for medical costs.`,
      action: { label: "See your HSA", href: "/investments/hsa" },
    };
  },
};

const backdoorRoth: Detector = {
  capability: "investing",
  topic: "backdoor_roth",
  covers: ["retirement_plan"],
  needs: ["monthly_income", "has_401k"],
  detect({ profile }) {
    const income = profile.facts.monthly_income;
    const pay = annual(income.value);
    // A joint return's Roth limit is about double a single filer's, so a couple needs about
    // twice the pay before this applies.
    const limit =
      profile.facts.household.value === "single"
        ? R.backdoorIncomeMinCents
        : R.backdoorIncomeMinCents * 2;
    if (profile.facts.income_pattern.value !== "salary" || pay < limit) return null;
    const growth = Math.round(
      R.iraLimitCents * ((1 + R.assumedGrowthBps / 10_000) ** R.growthYears - 1),
    );
    return {
      id: suggestionId("investing", "backdoor_roth"),
      capability: "investing",
      topic: "backdoor_roth",
      title: "Ask whether a backdoor Roth IRA fits you",
      worthCents: Math.round(growth * R.growthTaxRate),
      worthKind: "saves",
      confidence: weakest([
        factEvidence(income),
        evidence("seen", profile.months, 1, "high salary deposits"),
      ]),
      urgency: "later",
      why: `Your pay of about ${formatCents(pay)} a year is above where a direct Roth IRA is usually allowed. A backdoor Roth lets ${formatCents(R.iraLimitCents)} a year grow tax free; at an assumed ${R.assumedGrowthBps / 100}% a year that is about ${formatCents(growth)} of growth over ${R.growthYears} years, saving about ${formatCents(Math.round(growth * R.growthTaxRate))} in tax. Check the rules for your situation with a tax professional.`,
      action: { label: "See Roth options", href: "/investments/retirement-accounts" },
    };
  },
};

const education529: Detector = {
  capability: "investing",
  topic: "education_529",
  covers: ["college_plan"],
  needs: ["has_children"],
  detect({ profile }) {
    const kids = profile.facts.has_children;
    if (kids.value !== true) return null;
    return {
      id: suggestionId("investing", "education_529"),
      capability: "investing",
      topic: "education_529",
      title: "Start a 529 college savings plan",
      worthCents: Math.round(R.college529Cents * R.college529StateRate),
      worthKind: "saves",
      confidence: factEvidence(kids),
      urgency: "later",
      why: `You have children at home. Many states give a tax deduction on 529 contributions; on ${formatCents(R.college529Cents)} a year at an assumed ${Math.round(R.college529StateRate * 100)}% state rate that is about ${formatCents(Math.round(R.college529Cents * R.college529StateRate))}, and the growth is tax free for school costs.`,
      action: { label: "Plan for college", href: "/investments/college" },
    };
  },
};

const requiredWithdrawals: Detector = {
  capability: "investing",
  topic: "rmd",
  covers: ["retirement_income"],
  needs: ["life_stage"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    if (stage.value !== "retired") return null;
    const pre = data.accounts.filter((a) => a.subtype === "ira" || a.subtype === "401k");
    const balance = sum(pre);
    if (balance === 0) return null;
    const rmd = Math.round(balance / R.rmdDivisor);
    return {
      id: suggestionId("investing", "rmd"),
      capability: "investing",
      topic: "rmd",
      title: "Plan your required withdrawals from your retirement accounts",
      worthCents: Math.round(rmd * R.rmdPenaltyRate),
      worthKind: "risk",
      confidence: weakest([
        { percent: stage.confidence, reason: "your age is a guess from your accounts and income" },
        evidence("seen", profile.months, pre.length, "pre-tax retirement accounts"),
      ]),
      urgency: "soon",
      why: `You are retired and hold ${formatCents(balance)} in pre-tax retirement accounts. Required withdrawals start in your early-to-mid 70s and would be roughly ${formatCents(rmd)} a year; missing one costs a ${Math.round(R.rmdPenaltyRate * 100)}% penalty, about ${formatCents(Math.round(rmd * R.rmdPenaltyRate))}.`,
      action: { label: "Plan your income", href: "/investments/retirement-income" },
    };
  },
};

export const INVESTING_DETECTORS: readonly Detector[] = [
  employerMatch,
  catchUp,
  hsaIdle,
  backdoorRoth,
  education529,
  requiredWithdrawals,
];
