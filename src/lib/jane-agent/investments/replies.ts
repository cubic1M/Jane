import { GOALS, INVESTMENT_AUTOPILOT, PROFILE_QUESTIONS, RISK_LEVELS } from "@/config/investing";
import { portfolioNote } from "@/insights/portfolio-note";
import { RETURNS_NOTE } from "@/config/returns";
import { formatReturn } from "@/insights/returns";
import type { Returns } from "@/lib/investments/returns";
import { formatBps, type InvestmentAccountView, type HoldingView } from "@/insights/investments";
import type { FeeSummary } from "@/insights/investment-fees";
import { classWords, listWords, type PortfolioReview } from "@/insights/portfolio-review";
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
import { mixLine, planSummary, rebalanceButton, SIMULATED_WORDS } from "./rebalance-copy";
import type { RebalancePlan } from "@/insights/rebalance";
import type { loadAutoInvest } from "@/lib/investments/auto-invest";
import type { AccountPlan } from "@/lib/investments/accounts";
import type { InvestmentSnapshot } from "./snapshot";
import {
  AUTO_LINK,
  AUTO_PROMISE,
  pauseButton,
  resumeButton,
  runLine,
  startButtons,
} from "./auto-copy";
import { learnLink } from "../learn";
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
      body: `Your ${a.name} has ${balance} in ${holdingsWord(a.holdings.length)}. Biggest first:\n${a.holdings.map(line).join("\n")}\nFrom ${a.institution ?? "your bank"}.`,
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
  if (!advice || fees.equivalents.length === 0) {
    return { body, actions: [link, learnLink("fees")], refs: {} };
  }
  body += `\n\nLower-cost equivalents:\n${fees.equivalents.map((e) => `- ${equivalentLine(e)}`).join("\n")}\n${switchSummary(fees.equivalents, fees.years)}`;
  return { body, actions: [link, learnLink("index-funds")], refs: { advice: true } };
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
    actions: [link, learnLink("rebalancing")],
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
  return {
    body: `${lines}\n${changes}${roth}`,
    actions: [link, learnLink("the-match")],
    refs: { advice: true },
  };
}

// Spec step 133: the orders that move to the recommended mix, with the button.
export function rebalanceReply(
  advice: boolean,
  plan: RebalancePlan | null,
  profile: ProfileSummary,
): Reply {
  if (!advice) {
    return {
      body: "I don't place investment orders on real accounts yet.",
      actions: [SEE],
      refs: {},
    };
  }
  if (!plan) {
    const ask = asking(profile.complete ? PROFILE_QUESTIONS[0] : profile.next);
    return {
      body: "To work out your recommended mix I need four quick answers first.",
      actions: ask.actions,
      refs: ask.refs,
    };
  }
  if (plan.orders.length === 0) {
    return {
      body: `Your mix is already on target: ${mixLine(plan.after)}. Nothing to trade.`,
      actions: [SEE],
      refs: { advice: true },
    };
  }
  return rebalanceOffer(plan);
}

// The orders and the button that places them.
export function rebalanceOffer(plan: RebalancePlan): Reply {
  return {
    body: `I've got ${plan.orders.length} orders ready to move you to your ${RISK_LEVELS[plan.riskLevel].label.toLowerCase()} mix, ${SIMULATED_WORDS}.\n${planSummary(plan)}\nTap and I'll place them.`,
    actions: [
      rebalanceButton(),
      { id: "open", label: "See the orders", kind: "link", href: "/investments/rebalance" },
      learnLink("rebalancing"),
    ],
    refs: { advice: true, rebalanceKey: plan.key },
  };
}

// Spec step 134: automatic investing: what it does now, or the offer to start.
export function autoInvestReply(data: Awaited<ReturnType<typeof loadAutoInvest>>): Reply {
  if (!data.advice) {
    return {
      body: "I don't invest automatically for real accounts yet.",
      actions: [SEE],
      refs: {},
    };
  }
  if (!data.profileComplete) {
    const ask = asking(PROFILE_QUESTIONS[0]);
    return {
      body: "Before I invest for you, four quick answers about what the money is for.",
      actions: ask.actions,
      refs: ask.refs,
    };
  }
  const last = data.runs[0];
  if (data.plan) {
    const what =
      data.plan.mode === "leftover"
        ? "the rest after bills and goals"
        : `${formatCents(data.plan.amountCents ?? 0)} every payday`;
    const lastLine = last ? ` Last: ${runLine(last)}` : "";
    if (data.plan.status === "paused") {
      return {
        body: `Automatic investing is paused (${what}).${lastLine}`,
        actions: [resumeButton(), AUTO_LINK],
        refs: {},
      };
    }
    return {
      body: `Automatic investing is on: ${what}. ${AUTO_PROMISE}${lastLine}`,
      actions: [pauseButton(), AUTO_LINK],
      refs: { advice: true },
    };
  }
  if (!data.suggestion) {
    return {
      body: "I need an investment account that isn't a workplace plan, and a paycheck to go by, before I can invest automatically.",
      actions: [SEE],
      refs: {},
    };
  }
  return {
    body: `I can invest ${formatCents(data.suggestion.amountCents)} every payday for you, or the rest after bills and goals. ${AUTO_PROMISE}`,
    actions: [...startButtons(data.suggestion.amountCents), AUTO_LINK],
    refs: { advice: true, autoInvest: data.suggestion },
  };
}

// Spec step 135: which account first, where to hold what, and gains not yet taxed.
export function accountsReply(plan: AccountPlan): Reply {
  const link: MessageAction = {
    id: "open",
    label: "See the order",
    kind: "link",
    href: "/investments/accounts",
  };
  const gains =
    plan.gains.gainsCents + plan.gains.lossesCents > 0
      ? `In your taxable accounts there's ${formatCents(plan.gains.gainsCents)} of gains and ${formatCents(plan.gains.lossesCents)} of losses not yet taxed.`
      : null;
  if (!plan.advice) {
    return {
      body: [gains, "I don't recommend an account order on real accounts yet."]
        .filter(Boolean)
        .join(" "),
      actions: [link],
      refs: {},
    };
  }
  if (!plan.order) {
    const ask = asking(plan.profile.complete ? PROFILE_QUESTIONS[0] : plan.profile.next);
    return {
      body: "The order depends on what the money is for and when you'll need it. Four quick answers first.",
      actions: ask.actions,
      refs: ask.refs,
    };
  }
  const order = plan.order
    .map(
      (s, i) =>
        `${i + 1}. ${s.title}${s.roomCents !== null ? ` (up to ${formatCents(s.roomCents)} a year)` : ""}. ${s.why}`,
    )
    .join("\n");
  const location = plan.location.length
    ? `\nWhere to hold what:\n${plan.location.map((m) => `- ${m.holding.name} is better in ${m.better}. ${m.why}`).join("\n")}`
    : "";
  const [first, ...rest] = plan.order;
  const lead = `Fill ${first.short} first${rest.length > 0 ? `, then ${listWords(rest.map((s) => s.short))}` : ""}.`;
  return {
    body: `${lead}\n${order}${location}${gains ? `\n${gains}` : ""}`,
    actions: [link, learnLink("roth-vs-traditional")],
    refs: { advice: true },
  };
}

// Spec step 137: how the investments stand this month, with at most one decision.
export function overviewReply(snapshot: InvestmentSnapshot): Reply {
  if (snapshot.accounts.length === 0) {
    return {
      body: "I don't see any investment or retirement accounts yet. Link one and I'll tell you each month how it's going.",
      actions: [CONNECT],
      refs: {},
    };
  }
  const plan =
    snapshot.rebalance && snapshot.rebalance.orders.length > 0 ? snapshot.rebalance : null;
  const note = portfolioNote({
    month: snapshot.month.month,
    totalCents: snapshot.totalCents,
    previousCents: snapshot.month.previousCents,
    contributedCents: snapshot.month.contributedCents,
    feesYearlyCents: snapshot.fees.totalYearlyCents,
    review: snapshot.advice ? snapshot.review : null,
    ordersReady: snapshot.advice ? (plan?.orders.length ?? 0) : 0,
  });
  const returned = returnsLine(snapshot.returns);
  return {
    body: returned ? `${note.body} ${returned}` : note.body,
    actions: [...(note.decision ? [rebalanceButton()] : []), SEE],
    refs: {
      ...(snapshot.advice && snapshot.review ? { advice: true as const } : {}),
      ...(note.decision && plan ? { rebalanceKey: plan.key } : {}),
    },
  };
}

// Spec step 137: what Jane does with investments by herself at the person's level.
export function autopilotReply(level: string | null): Reply {
  const key = (
    level && Object.hasOwn(INVESTMENT_AUTOPILOT, level) ? level : "none"
  ) as keyof typeof INVESTMENT_AUTOPILOT;
  const lines = INVESTMENT_AUTOPILOT[key];
  return {
    body: `${level ? `On your autopilot setting, here's` : "Here's"} what I do with your investments by myself. ${lines.join(" ")}`,
    actions: [SEE, { id: "open", label: "Change autopilot", kind: "link", href: "/settings" }],
    refs: {},
  };
}

// Spec step 156: one line on how they've done over the longest period Jane can measure.
export function returnsLine(returns: Returns): string | null {
  const p = returns.periods.at(-1);
  if (!p || p.timeWeighted === null) return null;
  const money =
    p.moneyWeighted === null ? "" : ` (your own money: ${formatReturn(p.moneyWeighted)})`;
  const mix =
    p.benchmark === null
      ? ""
      : `, against ${formatReturn(p.benchmark)} for a similar mix of index funds`;
  const paid =
    p.incomeCents > 0 ? `, and paid ${formatCents(p.incomeCents)} in dividends and interest` : "";
  return `${p.label}, what you own returned ${formatReturn(p.timeWeighted)}${money}${mix}${paid}.`;
}

export function returnsReply(returns: Returns): Reply {
  if (returns.periods.length === 0) {
    return {
      body: "I can't work out returns yet: I need at least two days of balances. I take a snapshot every day, so check back tomorrow.",
      actions: [SEE],
      refs: {},
    };
  }
  const lines = returns.periods.map(
    (p) =>
      `- ${p.label}: ${p.timeWeighted === null ? "not known" : formatReturn(p.timeWeighted)}${p.moneyWeighted === null ? "" : `; your money ${formatReturn(p.moneyWeighted)}`}${p.benchmark === null ? "" : `; similar mix ${formatReturn(p.benchmark)}`}`,
  );
  return {
    body: `${returnsLine(returns) ?? "Here's how they've done."}\n${lines.join("\n")}\n${RETURNS_NOTE}${returns.simulatedPrices ? " The prices are the demo price feed's (made up)." : ""}`,
    actions: [SEE],
    refs: {},
  };
}
