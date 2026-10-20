import { GOALS, INVESTMENT_AUTOPILOT, PROFILE_QUESTIONS, RISK_LEVELS } from "@/config/investing";
import { portfolioNote } from "@/insights/portfolio-note";
import { RETURNS_NOTE } from "@/config/returns";
import { formatReturn } from "@/insights/returns";
import type { Returns } from "@/lib/investments/returns";
import type { Bucket } from "@/planning/goal-buckets";
import { COLLEGE_TYPES } from "@/config/college";
import type { CollegeEstimate } from "@/lib/investments/college";
import type { HsaView } from "@/lib/investments/hsa";
import type { CompanyStockView } from "@/lib/investments/company-stock";
import type { CryptoView } from "@/lib/crypto/crypto";
import type { CashView } from "@/lib/investments/cash";
import { CASH_LINK, cashLine, moveButtons } from "./cash-copy";
import type { SteadyView } from "@/lib/investments/steady-hand";
import { NO_PREDICTION } from "@/config/steady-hand";
import type { RetirementAccountsView } from "@/lib/investments/retirement-accounts";
import {
  iraButton,
  limitsLine,
  matchButton,
  raMatchLine,
  RA_LINK,
  rothLine,
} from "./retirement-accounts-copy";
import type { OldAccountsView } from "@/lib/investments/old-accounts";
import { foundLine, OLD_LINK, rollButton, summaryLine } from "./old-accounts-copy";
import type { RetirementIncomeView } from "@/lib/investments/retirement-income";
import { drawLine, paycheckLine, RI_LINK, rmdLine, ssLine } from "./retirement-income-copy";
import type { FamilyView } from "@/lib/investments/family";
import { FAMILY_LINK, familyLine } from "./family-copy";
import type { PropertyView } from "@/lib/investments/property";
import { homeLine, paydownLine, PROPERTY_LINK, rentalLine } from "./property-copy";
import { STEADY_LINK, steadyMessage, timelines } from "./steady-copy";
import { CRYPTO_LINK, feeFlag, NEVER_TRADES, shareFlag, sizeLine } from "./crypto-copy";
import {
  COMPANY_LINK,
  concentrationLine,
  planLine,
  sellButton,
  sellDue,
  SELL_WORDS,
} from "./company-copy";
import { byHerselfLine } from "./goals-copy";
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

// Spec step 157: each goal's bucket and why.
export function goalBucketsReply(data: {
  advice: boolean;
  byHerself: boolean;
  buckets: Bucket[] | null;
}): Reply {
  const link: MessageAction = {
    id: "open",
    label: "See each goal",
    kind: "link",
    href: "/investments/goals",
  };
  if (!data.advice) {
    return {
      body: "Investing by goal is only in demo advice mode for now.",
      actions: [SEE],
      refs: {},
    };
  }
  if (!data.buckets) {
    const ask = asking(PROFILE_QUESTIONS[0]);
    return {
      body: "Each goal's mix is capped by your risk level, so four quick answers first.",
      actions: ask.actions,
      refs: ask.refs,
    };
  }
  if (data.buckets.length === 0) {
    return {
      body: "You don't have a goal with a date yet. Add one and I'll invest for it, cash when it's close and safer as the date nears.",
      actions: [{ id: "open", label: "Add a goal", kind: "link", href: "/goals" }],
      refs: {},
    };
  }
  return {
    body: `Each goal is invested for when you need it.\n${data.buckets.map((b) => `- ${b.name}: ${b.why}`).join("\n")}\n${byHerselfLine(data.byHerself)}`,
    actions: [link],
    refs: { advice: true },
  };
}

// Spec step 158: what college could cost and what to put aside, with the button.
export function collegeReply(
  advice: boolean,
  estimate: CollegeEstimate | null,
  plans: number,
): Reply {
  const link: MessageAction = {
    id: "open",
    label: "Plan for college",
    kind: "link",
    href: "/investments/college",
  };
  if (!advice) {
    return {
      body: "College savings plans are only in demo advice mode for now.",
      actions: [link],
      refs: {},
    };
  }
  if (!estimate) {
    return {
      body: `Tell me how old your child is and I'll work out what to put aside, for example "college for my 5 year old"${plans > 0 ? `. You have ${plans} college ${plans === 1 ? "plan" : "plans"} already` : ""}.`,
      actions: [link],
      refs: {},
    };
  }
  const best = estimate.plans[0];
  const benefit =
    best && best.benefitCents > 0
      ? `, with your state's tax break of about ${formatCents(best.benefitCents)} a year`
      : "";
  return {
    body: `For a ${estimate.childAge}-year-old at ${COLLEGE_TYPES[estimate.type].toLowerCase()}, four years could cost about ${formatCents(estimate.cost.lowCents)} to ${formatCents(estimate.cost.highCents)} when they start in ${estimate.years} years. Putting aside about ${formatCents(estimate.monthly.lowCents)} to ${formatCents(estimate.monthly.highCents)} a month gets there, depending on prices and returns.${best ? ` The plan that comes out ahead: ${best.plan.name}${benefit}.` : ""} Tap and I'll set it up as a goal and invest for it.`,
    actions: [{ id: "college.start", label: "Start saving for college", kind: "primary" }, link],
    refs: {
      advice: true,
      college: { childName: "your child", childAge: estimate.childAge, type: estimate.type },
    },
  };
}

// Spec step 159: the HSA and its receipts vault.
export function hsaReply(view: HsaView): Reply {
  const link: MessageAction = {
    id: "open",
    label: "See your HSA",
    kind: "link",
    href: "/investments/hsa",
  };
  const vault =
    view.savedCents > 0
      ? ` Your receipts vault has ${formatCents(view.savedCents)} of medical costs you can pay back from it tax-free.`
      : "";
  if (!view.account || !view.plan) {
    return {
      body: `I don't see an HSA yet.${vault}`,
      actions:
        view.demo && view.advice
          ? [{ id: "hsa.link", label: "Link a demo HSA", kind: "primary" }, link]
          : [link],
      refs: {},
    };
  }
  const p = view.plan;
  const facts = `Your HSA has ${formatCents(view.account.balanceCents)}: ${formatCents(p.cashCents)} in cash and ${formatCents(p.investedCents)} invested. This year you can put in ${formatCents(p.roomCents)} more under the ${formatCents(p.limitCents)} limit.${vault}`;
  if (!view.advice || p.toInvestCents <= 0) return { body: facts, actions: [link], refs: {} };
  return {
    body: `${facts} ${formatCents(p.toInvestCents)} of the cash is beyond the ${formatCents(p.cushionCents)} cushion and could be invested, in the simulated brokerage (no real money moves).`,
    actions: [
      { id: "hsa.invest", label: `Invest ${formatCents(p.toInvestCents)}`, kind: "primary" },
      link,
    ],
    refs: { advice: true },
  };
}

// Spec step 160: company stock. Facts for everyone; the plan to sell down in demo advice mode.
export function companyStockReply(view: CompanyStockView, today: string): Reply {
  if (!view.company) {
    return {
      body: "I don't see stock from where you work. Add a grant (RSUs, an ESPP or options) and I'll keep an eye on how much of your investing is in it.",
      actions:
        view.demo && view.advice
          ? [{ id: "company.link", label: "Link a demo stock plan", kind: "primary" }, COMPANY_LINK]
          : [COMPANY_LINK],
      refs: {},
    };
  }
  const facts = concentrationLine(view);
  const plan = view.advice ? planLine(view, today) : null;
  if (!plan || !view.plan) return { body: facts, actions: [COMPANY_LINK], refs: {} };
  const due = sellDue(view, today);
  return {
    body: `${facts} ${plan}${due ? ` ${SELL_WORDS}` : ""}`,
    actions: due ? [sellButton(view), COMPANY_LINK] : [COMPANY_LINK],
    refs: { advice: true, ...(due ? { companyPlan: view.plan.key } : {}) },
  };
}

// Spec step 161: crypto. What it's worth and where it's read from, with when; the flags in
// demo advice mode. Asked to buy or sell, the answer is the same: Jane never trades crypto.
export function cryptoReply(view: CryptoView): Reply {
  const holding = view.connections.filter((c) => c.totalCents > 0);
  if (holding.length === 0) {
    return {
      body: `I don't see any crypto. ${view.demo ? "Want to connect a demo exchange? " : ""}${NEVER_TRADES}`,
      actions: view.demo
        ? [{ id: "crypto.link", label: "Connect a demo exchange", kind: "primary" }, CRYPTO_LINK]
        : [CRYPTO_LINK],
      refs: {},
    };
  }
  const asOf = holding
    .map((c) => c.asOf)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const when = asOf
    ? ` As of ${asOf.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })}${holding.some((c) => c.stale) ? " (out of date)" : ""}.`
    : "";
  const facts = `${sizeLine(
    view.size,
    holding.map((c) => c.name),
  )}${when}`;
  const flags = view.advice
    ? [
        view.size.overShare ? shareFlag(view.size) : null,
        view.fees?.flag ? feeFlag(view.fees) : null,
      ].filter(Boolean)
    : [];
  return {
    body: [facts, ...flags, NEVER_TRADES].join(" "),
    actions: [CRYPTO_LINK],
    refs: flags.length > 0 ? { advice: true } : {},
  };
}

// Spec step 162: where cash sits and what it earns; the plan and its taps in demo advice
// mode. The emergency fund is always somewhere it can be reached in days.
export function cashReply(view: CashView): Reply {
  if (view.places.length === 0 || !view.plan) {
    return {
      body: "I don't see checking, savings or brokerage cash yet.",
      actions: [CASH_LINK],
      refs: {},
    };
  }
  const plan = view.plan;
  if (!view.advice) {
    const where = view.places.map((p) => `${formatCents(p.balanceCents)} in ${p.name}`).join(", ");
    return {
      body: `Your cash: ${where}. I don't give recommendations on real accounts yet.`,
      actions: [CASH_LINK],
      refs: {},
    };
  }
  return {
    body: cashLine(plan),
    actions: [...moveButtons(plan), CASH_LINK],
    refs: { advice: true, ...(plan.moves.length > 0 ? { cashPlan: plan.key } : {}) },
  };
}

// Spec step 163: asked about a drop or about selling, in demo advice mode. Facts about the
// past and the person's own plan; never what markets will do.
export function steadyReply(view: SteadyView): Reply {
  if (!view.advice) {
    return {
      body: `I don't give recommendations on real accounts yet. ${NO_PREDICTION}`,
      actions: [STEADY_LINK],
      refs: {},
    };
  }
  if (!view.drop) {
    return {
      body: `Your investments haven't had a big drop lately. ${timelines(view.buckets)} ${NO_PREDICTION} If you ever want to sell, I'll show what it would cost before you do.`,
      actions: [STEADY_LINK],
      refs: { advice: true },
    };
  }
  return {
    body: steadyMessage(view.drop, view.buckets),
    actions: [STEADY_LINK],
    refs: { advice: true },
  };
}

// Spec step 210: every limit with what's used, then (in demo advice mode) the match, Roth or
// traditional and the taps. Facts for everyone; advice only in demo advice mode.
export function retirementAccountsReply(view: RetirementAccountsView): Reply {
  const limits = view.limits.length > 0 ? `This year: ${limitsLine(view)}.` : "";
  if (!view.advice) {
    return {
      body: `${limits || "I don't see retirement accounts yet."} I don't give recommendations on real accounts yet.`,
      actions: [RA_LINK],
      refs: {},
    };
  }
  const parts = [
    limits,
    raMatchLine(view) ?? "You're getting the whole match.",
    rothLine(view),
  ].filter(Boolean);
  const buttons = [matchButton(view), iraButton(view)].filter(
    (b): b is NonNullable<typeof b> => b !== null,
  );
  return {
    body: parts.join(" "),
    actions: [...buttons, RA_LINK],
    refs: { advice: true, ...(iraButton(view) ? { iraCents: view.iraAllowedCents } : {}) },
  };
}

// Spec step 211: where each past employer's plan stands; a found plan's fees and the
// rollover tap in demo advice mode.
export function oldAccountsReply(view: OldAccountsView): Reply {
  const found = view.plans.find((p) => p.status === "found");
  const base = summaryLine(view.plans);
  if (view.advice && found) {
    return {
      body: `${base}. ${foundLine(found)}`,
      actions: [rollButton(), OLD_LINK],
      refs: { advice: true, oldPlanId: found.id },
    };
  }
  return { body: base.endsWith(".") ? base : `${base}.`, actions: [OLD_LINK], refs: {} };
}

// Spec step 212: Social Security options, the minimums, the order to draw and the paycheck
// with how long it lasts, in demo advice mode; just the Social Security and minimum facts
// otherwise. Ranges, never a promise.
export function retirementIncomeReply(view: RetirementIncomeView): Reply {
  const facts = [ssLine(view), rmdLine(view)].filter(Boolean);
  if (!view.advice) {
    return {
      body: `${facts.join(" ") || "Tell me your Social Security statement's amount and when you plan to retire."} I don't give recommendations on real accounts yet.`,
      actions: [RI_LINK],
      refs: {},
    };
  }
  const parts = [paycheckLine(view), ...facts, drawLine(view)].filter(Boolean);
  return {
    body:
      parts.join(" ") ||
      "Tell me your Social Security statement's amount and when you plan to retire, and I'll work out a paycheck that lasts.",
    actions: [RI_LINK],
    refs: { advice: true },
  };
}

// Spec step 213: where each child stands. Facts for everyone; the gift link and the Roth
// IRA only in demo advice mode (and a link is never put in a reply, only on the family page).
export function familyReply(view: FamilyView): Reply {
  return {
    body: view.advice
      ? familyLine(view)
      : "I don't give recommendations on real accounts yet. You can still add your children on the family page.",
    actions: [FAMILY_LINK],
    refs: view.advice ? { advice: true } : {},
  };
}

// Spec step 214: home equity and rentals (facts), and paying down against investing with
// both sides (demo advice mode).
export function propertyReply(view: PropertyView): Reply {
  const facts = [...view.homes.map(homeLine), ...view.rentals.map(rentalLine)];
  const advice = view.advice && view.paydown ? [paydownLine(view.paydown)] : [];
  const body = [...facts, ...advice].join(" ");
  return {
    body:
      body ||
      "I don't see a home with a value or a rental yet. Add your home under Things you own, or a rental on the property page.",
    actions: [PROPERTY_LINK],
    refs: advice.length > 0 ? { advice: true } : {},
  };
}
