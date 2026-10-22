import { formatReturn } from "@/insights/returns";
import type { HonestView } from "@/lib/investments/honest";
import type { MessageAction } from "../types";

// Honest performance in the chat (spec step 233): what happened, never what will.

export const HONEST_LINK: MessageAction = {
  id: "open",
  label: "See the full picture",
  kind: "link",
  href: "/investments/performance",
};

const pts = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(1)} points`;

export function honestLine(view: HonestView): string {
  if (view.rows.length === 0)
    return "I need your investor profile finished and your investments linked to compare you with a benchmark of the same risk.";
  return view.rows
    .map((r) => {
      const worst = [...r.reasons].sort((a, b) => a.points - b.points)[0];
      return `Over ${r.label}${r.shorter ? ` (shorter history, from ${r.from})` : ""}: ${formatReturn(r.afterTaxes)} after fees and taxes against ${formatReturn(r.benchmark)} for a simple mix with your risk, ${pts(r.gap)}. The biggest reason: ${worst.label.toLowerCase()} (${pts(worst.points)}).`;
    })
    .join(" ");
}
