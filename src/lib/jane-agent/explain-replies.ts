import type { DecisionCard } from "@/lib/cards";
import { formatCents } from "@/lib/money";
import { optionLabel, type Comparison } from "@/planning/compare";
import { optionsBlock } from "./block-data";
import type { Reply } from "./replies";
import { sentence } from "./sources/source";
import type { MessageAction } from "./types";
import { dayLabel } from "@/lib/day-label";

// "Why?" and "Show options" (spec step 90): the quick replies on a finding, answered with
// the card's own fixed wording (the same as finding_details and the card page), so they
// work with no Anthropic key. Pure. Each ends with the finding's own buttons, so the person
// can decide right there.

// "Aug 14", Jane's way, when it's a plain date.
const dayOf = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? dayLabel(date) : date);

// What's left of a finding's buttons for the answer: the decision, not the quick replies.
const decisionButtons = (actions: readonly MessageAction[]) =>
  actions.filter((a) => a.kind !== "quick");

export function whyReply(card: DecisionCard, actions: readonly MessageAction[]): Reply {
  const lines = [sentence(card.explanation)];
  if (card.evidence.length > 0) {
    lines.push(
      ...card.evidence.map(
        (row) =>
          `- ${row.date ? `${dayOf(row.date)}: ` : ""}${row.label}${row.amountCents !== null ? `, ${formatCents(row.amountCents)}` : ""}`,
      ),
    );
  }
  lines.push(
    `If you say yes: ${sentence(card.whatChanges)} You'd give up: ${sentence(card.giveUp)}`,
  );
  return { body: lines.join("\n"), actions: decisionButtons(actions), refs: {} };
}

export function optionsReply(
  card: DecisionCard,
  comparison: Comparison | null,
  actions: readonly MessageAction[],
): Reply {
  if (!comparison) {
    const others = card.alternatives;
    return {
      body:
        others.length > 0
          ? `Besides saying yes, you could:\n${others.map((a) => `- ${sentence(a)}`).join("\n")}`
          : `There's one way to handle this: ${sentence(card.whatChanges)}`,
      actions: decisionButtons(actions),
      refs: {},
    };
  }
  const savings = comparison.current.kind === "savings";
  const scored = (s: Comparison["pick"]) =>
    `${optionLabel(s.option)}: ${formatCents(s.firstYearCents)} ${savings ? "earned" : ""} in the first year, ${savings ? "about" : "saving about"} ${formatCents(s.savingCents)}${savings ? " more" : ""}${s.notes.length ? ` (${s.notes.join(", ")})` : ""}`.replace(
      /\s+/g,
      " ",
    );
  const lines = [
    `My pick is ${optionLabel(comparison.pick.option)}. ${sentence(comparison.why)}`,
    `You ${savings ? "earn" : "pay"} about ${formatCents(comparison.currentYearCents)} a year now.`,
    `- ${scored(comparison.pick)}`,
    ...comparison.runnersUp.map((s) => `- ${scored(s)}`),
  ];
  // Spec step 94: and side by side, as a table.
  return {
    body: lines.join("\n"),
    actions: decisionButtons(actions),
    refs: { block: optionsBlock(comparison) },
  };
}
