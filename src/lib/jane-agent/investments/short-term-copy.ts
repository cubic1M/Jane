import { MIN_GAIN_CENTS } from "@/config/short-term";
import type { Candidate } from "@/lib/investments/short-term";
import { formatCents } from "@/lib/money";
import { snoozeButton } from "../sources/source";
import { type Candidate as Card, type MessageAction, openLink } from "../types";
import { dayLabel } from "@/lib/day-label";
import { formatRate } from "@/lib/percent";

// Short-term money in the chat (spec step 234): shared words and buttons.

export const SHORT_LINK: MessageAction = openLink("See the options", "/investments/short-term");

export function candidateLine(c: Candidate): string {
  const top = c.options
    .slice(0, 3)
    .map((o) => `${o.product.name} ${formatRate(o.afterTaxBps)}`)
    .join(", ");
  const ladder = c.ladder
    ? ` A ladder of ${c.ladder.length} ${c.ladder.length === 1 ? "rung" : "rungs"} of Treasury bills, each maturing by ${dayLabel(c.endsOn, { year: true })} and rolling over until then, would earn about ${formatCents(c.gainCents)} a year more than savings, after tax.`
    : "";
  return `${c.name} (${formatCents(c.amountCents)}, needed by ${dayLabel(c.endsOn, { year: true })}): after tax, ${top}. Only places that can't lock your money past that date are on the list.${ladder}`;
}

export const ladderButton = (_c: Candidate): MessageAction => ({
  id: "ladder.build",
  label: "Build the ladder",
  kind: "primary",
});

// The money worth a card: no ladder yet, and the best place earns at least MIN_GAIN_CENTS a year
// more than savings (src/config/short-term.ts).
export const shortTermToBringUp = (candidates: readonly Candidate[]) =>
  candidates.filter((c) => !c.hasLadder && !(c.gainCents < MIN_GAIN_CENTS));

// One card a pot of money (a goal, the emergency fund above its floor), said as it is now: the
// source posts it and stillTrue says an open one again with today's figures (../plan-cards.ts).
export const shortTermCard = (c: Candidate): Pick<Card, "kind" | "body" | "refs" | "actions"> => ({
  kind: c.ladder ? "decision" : "heads_up",
  body: candidateLine(c),
  refs: { advice: true, shortKey: c.key, ...(c.ladder ? { ladderKey: c.key } : {}) },
  actions: [...(c.ladder ? [ladderButton(c)] : []), SHORT_LINK, snoozeButton()],
});

// What the card asks, not its figures (debug 3, 11-24: keyed by the amount to the nearest $1,000,
// so a goal's card came again as savings went in): which pot, and a ladder to build or, when
// there's none, which place is best for it.
export const shortAskKey = (c: Candidate) => `${c.key}:${c.ladder ? "ladder" : c.best.product.key}`;
