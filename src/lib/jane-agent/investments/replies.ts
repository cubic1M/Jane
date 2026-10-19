import { GOALS, PROFILE_QUESTIONS } from "@/config/investing";
import { formatBps, type InvestmentAccountView, type HoldingView } from "@/insights/investments";
import type { FeeSummary } from "@/insights/investment-fees";
import { classWords, type PortfolioReview } from "@/insights/portfolio-review";
import type { Investments } from "@/lib/investments/holdings";
import { formatCents } from "@/lib/money";
import {
  profileSummary,
  type ProfileAnswers,
  type ProfileSummary,
} from "@/planning/investor-profile";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";
import { ROTH_WORDS, type RetirementPlan } from "@/planning/retirement";
import { equivalentLine, feeRange, switchSummary } from "./fees-copy";
import { matchLine, projectionLine } from "./retirement-copy";
import { asking, PROFILE_INTRO } from "./profile-question";

// Jane's rule answers about investments (spec step 128 on). Pure: the numbers in, fixed
// wording and buttons out. Facts only, the same for every account; advice is in the later
// steps' answers, and only in demo advice mode.

const SEE: MessageAction = {
  id: "open",
  label: "See what you own",
  kind: "link",
  href: "/investments",
};
const CONNECT: MessageAction = {
  id: "open",
  label: "Link an account",
  kind: "link",
  href: "/connect",
};

const holdingsWord = (n: number) => `${n} ${n === 1 ? "holding" : "holdings"}`;

// The account the person named: "401k" finds a 401(k), "ira" an IRA or Roth IRA,
// "retirement" the retirement accounts, "brokerage" the rest.
export function matchAccounts(
  accounts: InvestmentAccountView[],
  named: string | null,
): InvestmentAccountView[] {
  if (!named) return accounts;
  const word = named.toLowerCase().replace(/[()\s]/g, "");
  const squash = (s: string) => s.toLowerCase().replace(/[()\s]/g, "");
  if (word.startsWith("retirement")) return accounts.filter((a) => a.kind === "retirement");
  if (word === "brokerage") {
    const named = accounts.filter((a) => squash(`${a.label} ${a.name}`).includes("brokerage"));
    return named.length > 0 ? named : accounts.filter((a) => a.kind === "investment");
  }
  return accounts.filter((a) => squash(`${a.label} ${a.name}`).includes(word));
}

const line = (h: HoldingView) =>
  `- ${h.name}${h.ticker ? ` (${h.ticker})` : ""}: ${formatCents(h.valueCents)}`;

export function holdingsReply(data: Investments, named: string | null): Reply {
  if (data.accounts.length === 0) {
    return {
      body: "I don't see any investment or retirement accounts yet. Link one and I'll show what's in it, with where every number comes from.",
      actions: [CONNECT],
      refs: {},
    };
  }
  const accounts = matchAccounts(data.accounts, named);
  if (accounts.length === 0) {
    return {
      body: `I don't see a ${named} among your accounts. You have ${data.accounts.map((a) => `${a.name} (${a.label})`).join(", ")}.`,
      actions: [SEE],
      refs: {},
    };
  }
  if (accounts.length === 1) {
    const a = accounts[0];
    const balance = a.balanceCents === null ? "no balance reported" : formatCents(a.balanceCents);
    if (a.holdings.length === 0) {
      return {
        body: `Your ${a.name} has ${balance}. Your bank reports the balance but not what's in it.`,
        actions: [SEE],
        refs: {},
      };
    }
    return {
      body: `Your ${a.name} has ${balance} in ${holdingsWord(a.holdings.length)}:\n${a.holdings.map(line).join("\n")}\nFrom ${a.institution ?? "your bank"}.`,
      actions: [SEE],
      refs: {},
    };
  }
  const biggest = accounts
    .flatMap((a) => a.holdings)
    .sort((x, y) => y.valueCents - x.valueCents)
    .slice(0, 3);
  const total = accounts.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0);
  const count = accounts.reduce((sum, a) => sum + a.holdings.length, 0);
  const each = accounts
    .map(
      (a) => `${a.name}: ${a.balanceCents === null ? "no balance" : formatCents(a.balanceCents)}`,
    )
    .join("; ");
  return {
    body: `You have ${formatCents(total)} across ${accounts.length} accounts (${each})${count > 0 ? `, in ${holdingsWord(count)}. The biggest:\n${biggest.map(line).join("\n")}` : "."}`,
    actions: [SEE],
    refs: {},
  };
}

// Spec step 129: the investor profile, or the questions when it isn't finished.
export function profileReply(answers: ProfileAnswers, asOf: string): Reply {
  const summary = profileSummary(answers, asOf);
  if (!summary.complete) {
    const ask = asking(summary.next);
    return {
      body:
        summary.answered === 0
          ? PROFILE_INTRO
          : `You've answered ${summary.answered} of ${PROFILE_QUESTIONS.length} questions about what your investments are for. Here's the next one.`,
      actions: ask.actions,
      refs: ask.refs,
    };
  }
  const goals = summary.goals.map((g) => GOALS[g]).join(", ");
  return {
    body: `Your investor profile: ${summary.why} ${summary.description} Age ${summary.age}; the money is for: ${goals}.${summary.stale ? " It's been a year: worth checking it still fits." : ""}`,
    actions: [{ id: "open", label: "Change it", kind: "link", href: "/investments/profile" }],
    refs: {},
  };
}

// Spec step 130: what investing costs; in demo advice mode, the lower-cost equivalents.
export function feesReply(fees: FeeSummary, advice: boolean): Reply {
  const link: MessageAction = {
    id: "open",
    label: "See the fees",
    kind: "link",
    href: "/investments/fees",
  };
  if (fees.funds.length === 0 && fees.advisoryCents + fees.accountFeesCents === 0) {
    return {
      body: "I don't see any investment fees yet. When your accounts report what they hold, I'll show each fund's yearly cost.",
      actions: [SEE],
      refs: {},
    };
  }
  const parts = [
    `Your investments cost about ${formatCents(fees.totalYearlyCents)} a year: ${formatCents(fees.fundsYearlyCents)} in fund costs`,
  ];
  if (fees.advisoryCents > 0) parts.push(`${formatCents(fees.advisoryCents)} in advisory fees`);
  if (fees.accountFeesCents > 0)
    parts.push(`${formatCents(fees.accountFeesCents)} in account fees`);
  const top = fees.funds
    .slice(0, 3)
    .map(
      (f) =>
        `- ${f.holding.name}: ${formatBps(f.expenseRatioBps)}, ${formatCents(f.yearlyCents)} a year`,
    )
    .join("\n");
  let body = `${parts.join(", ")}. Over ${fees.years} years that's roughly ${feeRange(fees.overYears)} with growth, depending on returns.\nThe costliest:\n${top}`;
  if (!advice || fees.equivalents.length === 0) return { body, actions: [link], refs: {} };
  body += `\n\nLower-cost equivalents:\n${fees.equivalents.map((e) => `- ${equivalentLine(e)}`).join("\n")}\n${switchSummary(fees.equivalents, fees.years)}`;
  return { body, actions: [link], refs: { advice: true } };
}

// Spec step 131: the portfolio review. Facts for everyone; what to change only in demo
// advice mode, and only once the profile is complete.
export function reviewReply(
  investments: Investments,
  profile: ProfileSummary,
  review: PortfolioReview | null,
  advice: boolean,
): Reply {
  const link: MessageAction = {
    id: "open",
    label: "See the review",
    kind: "link",
    href: "/investments/review",
  };
  if (investments.holdingCount === 0) return holdingsReply(investments, null);
  const mix = investments.byAssetClass
    .map((c) => `${formatCents(c.valueCents)} in ${classWords(c.label)}`)
    .join(", ");
  if (!advice) {
    return {
      body: `Here's your mix: ${mix}. I don't give investment recommendations on real accounts yet.`,
      actions: [link],
      refs: {},
    };
  }
  if (!profile.complete || !review) {
    const ask = asking(profile.complete ? PROFILE_QUESTIONS[0] : profile.next);
    return {
      body: `To check whether your investments fit you, I need four quick answers first. Here's your mix for now: ${mix}.`,
      actions: ask.actions,
      refs: ask.refs,
    };
  }
  const now = review.mix
    .map(
      (m) =>
        `${classWords(m.label)} ${Math.round(m.share * 100)}% (target ${Math.round(m.targetShare * 100)}%)`,
    )
    .join(", ");
  const changes =
    review.recommendations.length === 0
      ? "Your mix is on target: nothing to change."
      : `What I'd change:\n${review.recommendations.map((r, i) => `${i + 1}. ${r.what} ${r.why}`).join("\n")}`;
  return {
    body: `Against your ${review.riskLabel.toLowerCase()} profile: ${now}.\n${changes}`,
    actions: [link],
    refs: { advice: true },
  };
}

// Spec step 132: on track for retirement? Demo advice only, once the profile is in.
export function retirementReply(
  data: {
    profile: ProfileSummary;
    balanceCents: number;
    accounts: string[];
    retirement: RetirementPlan | null;
  },
  advice: boolean,
): Reply {
  const link: MessageAction = {
    id: "open",
    label: "See your retirement plan",
    kind: "link",
    href: "/investments/retirement",
  };
  if (data.accounts.length === 0) {
    return {
      body: "I don't see a retirement account yet. Link your 401(k) or IRA and I'll show where you're headed.",
      actions: [CONNECT],
      refs: {},
    };
  }
  if (!advice) {
    return {
      body: `You have ${formatCents(data.balanceCents)} in ${data.accounts.join(" and ")}. My retirement planner is only in demo advice mode for now.`,
      actions: [SEE],
      refs: {},
    };
  }
  if (!data.profile.complete || !data.retirement) {
    const ask = asking(data.profile.complete ? PROFILE_QUESTIONS[0] : data.profile.next);
    return {
      body: `You have ${formatCents(data.balanceCents)} in ${data.accounts.join(" and ")}. To plan from here I need your age and three more quick answers.`,
      actions: ask.actions,
      refs: ask.refs,
    };
  }
  const plan = data.retirement;
  const lines = [projectionLine(plan), matchLine(plan)].filter(Boolean).join(" ");
  const changes =
    plan.changes.length === 0
      ? "Nothing to change: keep going as you are."
      : `What I'd change:\n${plan.changes.map((c, i) => `${i + 1}. ${c.what} ${c.why}`).join("\n")}`;
  const roth = plan.rothOrTraditional ? `\n${ROTH_WORDS[plan.rothOrTraditional]}` : "";
  return { body: `${lines}\n${changes}${roth}`, actions: [link], refs: { advice: true } };
}
