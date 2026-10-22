import { formatCents } from "@/lib/money";
import type { MoneyForTwoView } from "@/lib/money-for-two";
import { sharesWords } from "@/planning/money-for-two";
import type { Reply } from "./replies";

// Money for two in the chat (spec step 242): how shared bills split, joint goals, big moves
// waiting for a tap, and the monthly money date. Only what was shared, never the partner's
// own money.

const percent = (bps: number) => `${Math.round(bps / 100)}%`;

export function moneyForTwoReply(view: MoneyForTwoView | null): Reply {
  if (!view) {
    return {
      body: "Invite your partner on Household and you can run money together: bills split evenly or by income, joint goals, both taps for big moves, and a short money date each month. Your own accounts stay yours.",
      actions: [{ id: "open", label: "Invite your partner", kind: "link", href: "/household" }],
      refs: {},
    };
  }
  const split =
    view.rule === "income"
      ? `Shared bills split by income: you pay ${percent(view.myShareBps)}, ${view.partnerName} ${percent(10_000 - view.myShareBps)}.`
      : `Shared bills split half each.${view.chosen ? "" : ` By income it would be ${sharesWords(view.incomeMyShareBps)} (you first).`}`;
  const lines = [
    split,
    view.owedToMeCents === 0
      ? "You're all square."
      : view.owedToMeCents > 0
        ? `${view.partnerName} owes you ${formatCents(view.owedToMeCents)}.`
        : `You owe ${view.partnerName} ${formatCents(-view.owedToMeCents)}.`,
    view.jointGoals.length > 0
      ? `Joint goals: ${view.jointGoals.map((g) => `${g.name} ${formatCents(g.savedCents)} of ${formatCents(g.targetCents)}`).join("; ")}.`
      : null,
    `Moves of ${formatCents(view.bigMoveCents)} or more out of a shared account need both your taps.`,
    ...view.bigMoves.map((m) =>
      m.mine
        ? `${formatCents(m.amountCents)} to ${m.toName} waits for ${view.partnerName}'s tap.`
        : `${formatCents(m.amountCents)} to ${m.toName} waits for your tap.`,
    ),
  ].filter((l): l is string => Boolean(l));
  return {
    body: lines.join(" "),
    actions: [
      ...(!view.chosen
        ? [
            { id: "two.split_income" as const, label: "Split by income", kind: "primary" as const },
            { id: "two.split_even" as const, label: "Keep half each", kind: "secondary" as const },
          ]
        : []),
      { id: "open", label: "See household", kind: "link", href: "/household" },
    ],
    refs: {},
  };
}

// The money date (once a month, for both): spent together, who owes whom, joint goals, moves
// waiting. Short on purpose.
export function moneyDateBody(view: MoneyForTwoView): string {
  const goals = view.jointGoals.map(
    (g) => `${g.name} is ${Math.min(100, Math.round((g.savedCents / g.targetCents) * 100))}% there`,
  );
  const waiting = view.bigMoves.filter((m) => !m.mine).length;
  return [
    `Money date with ${view.partnerName}: ${formatCents(view.sharedSpentCents)} spent together this month so far.`,
    view.owedToMeCents === 0
      ? "You're all square."
      : view.owedToMeCents > 0
        ? `${view.partnerName} owes you ${formatCents(view.owedToMeCents)}.`
        : `You owe ${view.partnerName} ${formatCents(-view.owedToMeCents)}.`,
    goals.length > 0 ? `${goals.join("; ")}.` : null,
    waiting > 0
      ? `${waiting} big move${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""} for your tap.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
