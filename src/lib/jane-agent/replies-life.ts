import { LIFE_EVENTS, type LifeEventKind } from "@/config/life-events";
import { LIFE_AUTOMATION } from "@/config/life-signals";
import type { LifeGuess } from "@/insights/life-signals";
import type { ChecklistRun } from "@/lib/life-guesses";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import { dayLabel } from "@/lib/day-label";

// Life events in the chat (spec step 100): what Jane offers to do, what it did, and the
// answer to "I'm moving".

const and = (items: readonly string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// "I'll set a Home budget if you don't have one, flag your insurance to review and put
// reminders on your deadlines."
export function lifeOffer(kind: LifeEventKind): string {
  const plan = LIFE_AUTOMATION[kind];
  const parts = [
    ...(plan.budgets.length === 1 ? [`set a ${plan.budgets[0]} budget if you don't have one`] : []),
    ...(plan.budgets.length > 1 ? [`set ${and(plan.budgets)} budgets if you don't have them`] : []),
    ...(plan.insurance ? ["flag your insurance to review"] : []),
    ...(plan.reminders.length > 0 ? ["put reminders on your deadlines"] : []),
  ];
  return `I'll ${and(parts)}.`;
}

// What Jane did on Yes, in one note.
export function checklistNote(kind: LifeEventKind, run: ChecklistRun): string {
  const title = LIFE_EVENTS[kind].title.toLowerCase();
  const budgets = run.budgets.map((b) => `${b.category} at ${formatCents(b.amountCents)} a month`);
  const lines = [
    `Done. I started your ${title} checklist.`,
    ...(budgets.length > 0
      ? [`I set ${budgets.length === 1 ? "a budget" : "budgets"} for ${and(budgets)}.`]
      : []),
    ...(run.reminders.length > 0
      ? [
          `On your deadlines: ${and(run.reminders.map((r) => `"${r.title}" by ${dayLabel(r.dueOn)}`))}.`,
        ]
      : []),
  ];
  return lines.join(" ");
}

const links = [
  { id: "open", label: "Open the checklist", kind: "link", href: "/life-events" } as const,
];

// "I'm moving", "I got a new job", "we're having a baby".
export function lifeEventReply(kind: LifeEventKind, going: boolean): Reply {
  const title = LIFE_EVENTS[kind].title.toLowerCase();
  if (going) {
    return {
      body: `You already have a ${title} checklist going. Open it to see what's left.`,
      actions: [...links],
      refs: {},
    };
  }
  return {
    body: `${kind === "moving" ? "Exciting!" : "Congratulations!"} Want me to start your ${title} checklist? ${lifeOffer(kind)}`,
    actions: [{ id: "life.yes", label: "Start it", kind: "primary" }, ...links],
    refs: { lifeKind: kind },
  };
}

// For Claude: the guesses, in plain words.
export const guessLine = (g: LifeGuess) =>
  `${LIFE_EVENTS[g.kind].title}: ${g.signals.map((s) => s.text).join("; ")}`;
