import type { Candidate } from "@/lib/investments/short-term";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";
import { dayLabel } from "@/lib/day-label";

// Short-term money in the chat (spec step 234): shared words and buttons.

export const SHORT_LINK: MessageAction = {
  id: "open",
  label: "See the options",
  kind: "link",
  href: "/investments/short-term",
};

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export function candidateLine(c: Candidate): string {
  const top = c.options
    .slice(0, 3)
    .map((o) => `${o.product.name} ${pct(o.afterTaxBps)}`)
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
