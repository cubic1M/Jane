import { findDebt, sourceLabel, type Debt, type DebtBook } from "@/insights/debts";
import type { Payoff } from "@/lib/debt-plan";
import { formatCents } from "@/lib/money";
import type { PayoffPlan, Strategy } from "@/planning/debt";
import { monthAfter, monthName, type LeftOut } from "@/planning/payoff";
import type { DebtIntent } from "./debt-intents";
import type { Reply } from "./replies";
import { shortDate } from "./sources/source";
import type { MessageAction } from "./types";
import { formatRate } from "@/lib/percent";

// Jane's answers about debts (spec Phase Y), from the same debt book as the loans page
// (src/lib/debts.ts). Pure: fixed wording, every rate with where it came from.

const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});
export const SEE_DEBTS = link("See every debt", "/loans");

// "Oct 1, 2029".
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "at 6.90% fixed (from your bank)" or "with no rate yet".
export function rateWords(debt: Debt): string {
  if (debt.aprBps === null) return "with no rate yet";
  const type = debt.rateType ? ` ${debt.rateType}` : "";
  return `at ${formatRate(debt.aprBps)}${type} (${sourceLabel(debt.aprFrom, debt.typedOn)})`;
}

const paymentWords = (debt: Debt) =>
  debt.paymentCents === null
    ? null
    : `${formatCents(debt.paymentCents)} ${debt.paymentEvery === "month" ? "a month" : "every two weeks"}`;

// One line per debt in the list.
function line(debt: Debt): string {
  const head =
    debt.balanceCents !== null
      ? `${debt.name}: ${formatCents(debt.balanceCents)} ${rateWords(debt)}`
      : debt.aprBps === null
        ? `${debt.name}: balance and rate not known yet`
        : `${debt.name}: balance not known yet, ${rateWords(debt)}`;
  const parts = [head];
  const payment = paymentWords(debt);
  if (payment) parts.push(payment);
  if (debt.payoffDate) parts.push(`paid off by ${longDate(debt.payoffDate)}`);
  return `- ${parts.join(", ")}${debt.overdue ? ". Your bank shows it as overdue" : ""}`;
}

// "How much do I owe?": the total (the same as net worth counts), buy now, pay later plans
// on their own line, then every debt.
export function debtsReply(book: DebtBook): Reply {
  const accounts = book.debts.filter((d) => d.inNetWorth);
  const plans = book.debts.filter((d) => d.kind === "bnpl");
  const newLoans = book.debts.filter(
    (d) => d.key.startsWith("loan:") || d.key.startsWith("transfer:"),
  );
  if (book.debts.length === 0) {
    return {
      body: "I don't see any loans, cards or buy now, pay later plans. When you link a bank that reports them, I'll keep track of every one.",
      actions: [link("Link a bank", "/connect")],
      refs: {},
    };
  }
  const lines: string[] = [];
  if (accounts.length > 0) {
    lines.push(
      `You owe ${formatCents(book.accountsOwedCents)} on ${plural(accounts.length, "loan or card", "loans and cards")}, the same as your net worth counts.`,
    );
  }
  if (plans.length > 0) {
    const known = book.bnplOwedCents > 0 ? `${formatCents(book.bnplOwedCents)} left on ` : "";
    lines.push(
      `${accounts.length > 0 ? "Plus " : "You have "}${known}${plural(plans.length, "buy now, pay later plan", "buy now, pay later plans")}${
        book.bnplUnknown > 0 ? ` (${book.bnplUnknown} without a balance yet)` : ""
      }. Net worth doesn't count these: they aren't bank accounts.`,
    );
  }
  if (newLoans.length > 0) {
    lines.push(
      `And ${formatCents(book.newLoansOwedCents)} on ${newLoans.map((d) => `your new ${d.name}`).join(" and ")}, from the terms you accepted. Link it to see it in your net worth.`,
    );
  }
  lines.push(...book.debts.map(line));
  if (book.missingRate.length > 0) {
    lines.push(
      `I don't have a rate for ${book.missingRate.map((d) => d.name).join(" or ")}. Add it on the loans page and I'll count it.`,
    );
  }
  return { body: lines.join("\n"), actions: [SEE_DEBTS], refs: {} };
}

// "When is my car paid off?": one debt in full.
export function debtDetailReply(target: string, book: DebtBook): Reply {
  const debt = findDebt(book.debts, target);
  if (!debt) {
    const names = book.debts.map((d) => d.name);
    return {
      body:
        names.length === 0
          ? "I don't see any loans or cards yet."
          : `I can't find "${target}" among your debts. You have: ${names.join(", ")}.`,
      actions: [SEE_DEBTS],
      refs: {},
    };
  }
  const lines: string[] = [];
  lines.push(
    debt.balanceCents !== null
      ? `Your ${debt.name}: ${formatCents(debt.balanceCents)} left ${rateWords(debt)}.`
      : debt.aprBps === null
        ? `Your ${debt.name}: I don't know what's left on it or its rate yet.`
        : `Your ${debt.name}: I don't know what's left on it yet. It's ${rateWords(debt)}.`,
  );
  const payment = paymentWords(debt);
  if (payment) {
    lines.push(`You pay ${payment}${debt.nextDue ? `, next on ${shortDate(debt.nextDue)}` : ""}.`);
  }
  if (debt.payoffDate) {
    lines.push(
      `It's paid off by ${longDate(debt.payoffDate)} (${sourceLabel(debt.payoffFrom, debt.typedOn)}).`,
    );
  } else if (debt.kind === "card") {
    lines.push("A card has no end date: when it's paid off depends on what you pay each month.");
  } else {
    lines.push("I don't have its payoff date yet. Add it on the loans page and I'll keep it.");
  }
  if (debt.overdue) {
    lines.push(
      `Your bank shows it as overdue${debt.pastDueCents ? `: ${formatCents(debt.pastDueCents)} past due` : ""}.`,
    );
  }
  return { body: lines.join("\n"), actions: [SEE_DEBTS], refs: {} };
}

export function debtReply(
  intent: Extract<DebtIntent, { kind: "debts" | "debt_detail" }>,
  book: DebtBook,
): Reply {
  return intent.kind === "debts" ? debtsReply(book) : debtDetailReply(intent.target, book);
}

// --- Spec step 110: payoff plans ------------------------------------------------------

const STRATEGY_NAME: Record<Strategy, string> = {
  avalanche: "highest rate first",
  snowball: "smallest balance first",
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LEFT_OUT_WHY: Record<LeftOut["reason"], string> = {
  mortgage: "it runs on its own schedule",
  no_balance: "no balance yet",
  no_rate: "no rate yet",
  no_payment: "no payment yet",
};

// "Debt-free by March 2028 (17 months), with $1,234.56 of interest".
function outcome(plan: PayoffPlan, asOf: string): string {
  if (!plan.ok) {
    return plan.reason === "budget_below_minimums"
      ? "that's less than the minimums"
      : "it doesn't finish within 50 years";
  }
  return `debt-free by ${monthName(monthAfter(asOf, plan.months))} (${plural(plan.months, "month", "months")}), with ${formatCents(plan.totalInterestCents)} of interest`;
}

// The buttons that start the plan, Jane's pick first in demo advice mode.
export function planButtons(first: Strategy, label: (s: Strategy) => string): MessageAction[] {
  const other: Strategy = first === "avalanche" ? "snowball" : "avalanche";
  return [
    { id: `debt_plan.${first}`, label: label(first), kind: "primary" },
    { id: `debt_plan.${other}`, label: label(other), kind: "secondary" },
  ];
}

// "What's the fastest way out of debt?", "what if I pay $200 more?": the plan across every
// debt, with the planner's math. In demo advice mode Jane picks the order and says why
// (labelled); otherwise both orders side by side, as math, not a recommendation.
export function payoffReply(payoff: Payoff, asOf: string): Reply {
  const { summary, stored } = payoff;
  const planner = link("Open the payoff planner", "/debt");
  if (summary.cards.length === 0) {
    return {
      body:
        summary.leftOut.length > 0
          ? `I can't plan yet: ${summary.leftOut.map((l) => `${l.name} (${LEFT_OUT_WHY[l.reason]})`).join(", ")}.`
          : "You don't have any debts to pay off. Nice.",
      actions: [SEE_DEBTS],
      refs: {},
    };
  }
  const lines: string[] = [];
  const budget = summary.minimumsCents + summary.extraCents;
  const paying = `Paying ${formatCents(budget)} a month (your minimums${summary.extraCents > 0 ? ` plus ${formatCents(summary.extraCents)} extra` : ""})`;
  const pick = summary.pick;
  if (pick) {
    lines.push(`Here's how I'd pay them off: ${STRATEGY_NAME[pick.strategy]}.`);
    lines.push(...pick.order.map((name, i) => `${i + 1}. ${name}`));
    lines.push(...pick.why);
    lines.push(`${paying}, you'd be ${outcome(summary[pick.strategy], asOf)}.`);
  } else {
    lines.push(`${paying}, here's how two common orders would go:`);
    for (const s of ["avalanche", "snowball"] as const) {
      lines.push(`- ${capital(STRATEGY_NAME[s])}: ${outcome(summary[s], asOf)}`);
    }
  }
  const chosen = summary[pick?.strategy ?? "avalanche"];
  if (summary.baseline.ok && chosen.ok) {
    const saved = summary.baseline.totalInterestCents - chosen.totalInterestCents;
    if (saved > 0)
      lines.push(`That's ${formatCents(saved)} less interest than paying only the minimums.`);
  } else if (!summary.baseline.ok) {
    lines.push("Paying only the minimums on each, not everything would ever be paid off.");
  }
  const more = summary.scenarios.filter((s) => s.extraCents > summary.extraCents);
  if (more.length > 0) {
    lines.push(
      `With more each month: ${more
        .map(
          (s) =>
            `${formatCents(s.extraCents)} extra, debt-free by ${monthName(monthAfter(asOf, s.months))}`,
        )
        .join("; ")}.`,
    );
  }
  if (summary.leftOut.length > 0) {
    lines.push(
      `Not included: ${summary.leftOut.map((l) => `${l.name} (${LEFT_OUT_WHY[l.reason]})`).join(", ")}.`,
    );
  }
  if (!pick) lines.push("This is math, not a recommendation.");

  const same =
    stored &&
    stored.extraCents === summary.extraCents &&
    (pick ? stored.strategy === pick.strategy : true);
  if (same) {
    lines.push(
      `This is your plan (${STRATEGY_NAME[stored.strategy]}). I check it every month${
        stored.status === "off_track"
          ? ", and last time you were behind"
          : stored.status === "on_track"
            ? ", and last time you were on track"
            : ""
      }.`,
    );
    return { body: lines.join("\n"), actions: [planner], refs: pick ? { advice: true } : {} };
  }
  const actions = planButtons(pick?.strategy ?? "avalanche", (s) =>
    pick
      ? s === pick.strategy
        ? "Start this plan"
        : `Use ${STRATEGY_NAME[s]}`
      : `Track ${STRATEGY_NAME[s]}`,
  );
  return {
    body: lines.join("\n"),
    actions: [...actions, planner],
    refs: { debtPlanExtraCents: summary.extraCents, ...(pick ? { advice: true as const } : {}) },
  };
}
