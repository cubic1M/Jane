import type { MultiYearView } from "@/lib/multi-year";
import { formatCents } from "@/lib/money";
import type { Move } from "@/planning/multi-year";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { type MessageAction, type MessageRefs, openLink } from "./types";

// Tax moves over several years in the chat (spec step 220): the move that saves the most
// (demo advice), and the answer to "my taxes over the years", "Roth conversion".

const YEARS_HREF = "/taxes/years";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function yearsMoveMessage(view: MultiYearView, move: Move): Message {
  return {
    body: `${move.title} could save you about ${roundDollars(move.effectCents)} of tax over the years. ${move.why} Want it on your deadlines? Carrying it out is yours.`,
    refs: { advice: true, taxYear: view.year, yearsMove: move.key },
    actions: [
      { id: "tax.years_plan", label: "Put it on my plan", kind: "primary" },
      openLink("See my tax years", YEARS_HREF),
    ],
  };
}

export function yearsReply(view: MultiYearView): Message {
  // No tax in any year: there's no income to work it out from, not 35 years of no tax.
  if (view.rows.every((r) => r.totalTaxCents === 0)) {
    return {
      body: "I can't see enough income yet to show your tax year by year. Upload your bank statements or link a bank, or add your income on the taxes page.",
      refs: {},
      actions: [openLink("See my taxes", "/taxes")],
    };
  }
  const first = view.rows[0];
  const last = view.rows.find((r) => r.year === view.retireYear) ?? view.rows[view.rows.length - 1];
  const lines = [
    `${first.year} (your estimate): ${formatCents(first.totalTaxCents)} of federal tax, at a top rate of ${Math.round(first.marginalRate * 100)}%.`,
    `${last.year}${view.retireAssumed ? " (when I assumed you retire)" : " (when you retire)"}: about ${formatCents(last.totalTaxCents)}, at a top rate of ${Math.round(last.marginalRate * 100)}%.`,
    `About ${formatCents(view.lifetimeTaxCents)} of federal tax over ${view.rows.length} years in all.`,
  ];
  if (view.advice) {
    for (const m of view.moves.slice(0, 3)) {
      lines.push(`${m.title}: saves about ${formatCents(m.effectCents)} over the years.`);
    }
    if (view.moves.length === 0) lines.push("I don't see a move worth making right now.");
  }
  const top = view.advice ? view.moves[0] : undefined;
  return {
    body: `Here is your federal tax over the next ${view.rows.length} years.\n${lines.map((l) => `• ${l}`).join("\n")}\n${view.assumptions[0]}`,
    refs: top ? { advice: true, yearsMove: top.key } : view.advice ? { advice: true } : {},
    actions: [
      ...(top
        ? [
            {
              id: "tax.years_plan" as const,
              label: "Put the first on my plan",
              kind: "primary" as const,
            },
          ]
        : []),
      openLink("See my tax years", YEARS_HREF),
    ],
  };
}
