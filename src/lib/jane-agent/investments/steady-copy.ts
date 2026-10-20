import { RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";
import { NO_PREDICTION, PAUSE_YEARS } from "@/config/steady-hand";
import { formatReturn } from "@/insights/returns";
import { formatCents } from "@/lib/money";
import type { Bucket } from "@/planning/goal-buckets";
import { givenUp, type Drop } from "@/planning/steady-hand";
import type { MessageAction } from "../types";
import { bucketLine } from "./goals-copy";

// A steady hand in the chat (spec step 163): one calm message with what changed, what it
// means for each goal's timeline, and the plan. Past-tense facts and the person's own plan;
// never a word about what markets will do.

export const STEADY_LINK: MessageAction = {
  id: "open",
  label: "See how they've done",
  kind: "link",
  href: "/investments",
};

export const whatChanged = (drop: Drop) =>
  `Your investments are down ${formatReturn(drop.rate).replace("−", "")} over ${drop.windowLabel}, not counting money you put in or took out.`;

export function timelines(buckets: Bucket[]): string {
  if (buckets.length === 0)
    return "Money you need within the next few years is already in cash, not stocks, and money for later is invested for the long run.";
  const near = buckets.filter((b) => b.nearTerm);
  const far = buckets.filter((b) => !b.nearTerm);
  const parts = [
    near.length > 0
      ? `Already in cash, so the drop doesn't touch it: ${near.map(bucketLine).join("; ")}.`
      : "",
    far.length > 0
      ? `Invested for years away, with time to ride out swings: ${far.map(bucketLine).join("; ")}.`
      : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export const planLine =
  "The plan stays as it is: automatic investing keeps going on each payday, and each goal keeps its mix. Nothing needs doing today.";

export const steadyMessage = (drop: Drop, buckets: Bucket[]) =>
  `${whatChanged(drop)} ${timelines(buckets)} ${planLine} ${NO_PREDICTION} If you're thinking of selling, I'll show what it would cost first.`;

// The pause before a sell the person starts: what it gives up over the long run, as a
// range at the assumed returns, and that waiting costs nothing. Skippable: Sell anyway.
export function pauseNote(sellCents: number, drop: Drop): string {
  const g = givenUp(sellCents);
  return `Before you sell: your investments are down ${formatReturn(drop.rate).replace("−", "")} over ${drop.windowLabel}, and selling now turns that into a loss you keep. The ${formatCents(sellCents)} you'd take out would have grown by roughly ${formatCents(g.lowCents)} to ${formatCents(g.highCents)} over ${PAUSE_YEARS} years at the assumed ${Math.round(RETURN_LOW.value * 100)}% to ${Math.round(RETURN_HIGH.value * 100)}% a year (an assumption, not a promise). ${NO_PREDICTION} It's your call: sell anyway, or leave it a few days.`;
}
