import { findDebt, sourceLabel, type Debt, type DebtBook } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import type { DebtIntent } from "./debt-intents";
import type { Reply } from "./replies";
import { shortDate } from "./sources/source";
import type { MessageAction } from "./types";

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
  const plans = book.debts.filter((d) => !d.inNetWorth);
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

export function debtReply(intent: DebtIntent, book: DebtBook): Reply {
  return intent.kind === "debts" ? debtsReply(book) : debtDetailReply(intent.target, book);
}
