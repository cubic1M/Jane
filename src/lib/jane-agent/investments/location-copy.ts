import type { LocationPlan } from "@/planning/location";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// The right investment in the right account in the chat (spec step 231): shared words.

export const LOCATION_LINK: MessageAction = {
  id: "open",
  label: "See the swaps",
  kind: "link",
  href: "/investments/location",
};

const NAMES = {
  bonds: "bonds",
  us_stocks: "US stocks",
  intl_stocks: "international stocks",
} as const;

export const freeSwaps = (p: LocationPlan) => p.swaps.filter((s) => s.taxCents === 0);

export function locationLine(p: LocationPlan): string {
  const paid = p.swaps.filter((s) => s.taxCents > 0);
  const free = freeSwaps(p);
  const first = p.swaps[0];
  const how = first
    ? `For example, ${first.a.accountName} swaps ${NAMES[first.a.sell]} for ${NAMES[first.a.buy]} while ${first.b.accountName} does the reverse, ${formatCents(first.amountCents)} each.`
    : "";
  return `Holding bonds where their interest isn't taxed each year and stocks in taxable accounts would cut your tax on payouts from about ${formatCents(p.taxNowCents)} to ${formatCents(p.taxAfterCents)} a year: ${formatCents(p.savedCents)} less. Your overall mix stays exactly the same. ${how} ${free.length} of ${p.swaps.length} ${p.swaps.length === 1 ? "swap costs" : "swaps cost"} no tax${paid.length > 0 ? `; the other${paid.length === 1 ? "" : "s"} sell${paid.length === 1 ? "s" : ""} at a gain (${paid.map((s) => formatCents(s.taxCents)).join(", ")} in tax) and ${paid.length === 1 ? "is" : "are"} yours to choose on the swaps page` : ""}.`.replace(
    /\s+/g,
    " ",
  );
}

export const freeButton = (p: LocationPlan): MessageAction | null =>
  freeSwaps(p).length > 0
    ? {
        id: "location.free",
        label: `Make the ${freeSwaps(p).length === 1 ? "tax-free swap" : "tax-free swaps"}`,
        kind: "primary",
      }
    : null;
