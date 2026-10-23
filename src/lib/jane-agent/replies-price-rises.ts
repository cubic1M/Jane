import { formatCents } from "@/lib/money";
import type { PriceRise } from "@/planning/price-rises";
import type { Reply } from "./replies";

// Price rises seen before they land, in the chat (spec step 243).

export function priceRiseLine(r: PriceRise): string {
  return r.kind === "promo_end"
    ? `${r.name}'s intro price of ${formatCents(r.nowCents)} a month likely ends around ${r.date} (in ${r.daysLeft} days); after that it's usually about ${formatCents(r.thenCents)}. ${r.cheaper}`
    : `${r.name} renews around ${r.date} (in ${r.daysLeft} days) for about ${formatCents(r.thenCents)}. ${r.cheaper}`;
}

export function priceRisesReply(rises: readonly PriceRise[]): Reply {
  if (rises.length === 0) {
    return {
      body: "No intro prices ending or yearly plans renewing in the next ten weeks that I can see. I'll tell you a month ahead when one is.",
      actions: [{ id: "open", label: "See deadlines", kind: "link", href: "/deadlines" }],
      refs: {},
    };
  }
  const first = rises[0];
  return {
    body: [...rises.map(priceRiseLine), `What to say on the call: "${first.script}"`].join("\n"),
    actions: [{ id: "open", label: "See deadlines", kind: "link", href: "/deadlines" }],
    refs: {},
  };
}
