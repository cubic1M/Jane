import { CALL_SCRIPTS } from "@/config/price-rises";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { priceRises } from "@/planning/price-rises";
import { type Detector, suggestionId } from "./contract";

// Price rises seen before they land (spec step 243), brought to the person unasked: an intro
// price about to end, or a yearly plan about to renew, a month or more ahead. Pure; see
// ./contract.ts.

const promoEnding: Detector = {
  covers: ["price_rises"],
  capability: "price_rises",
  topic: "promo_ending",
  needs: [],
  detect({ profile, data }) {
    const rises = priceRises(
      data.transactions.map((t) => ({
        date: t.date,
        amountCents: t.amountCents,
        description: t.description,
        pfc: t.pfc,
      })),
      profile.today,
    ).filter((r) => r.daysLeft >= 0);
    if (rises.length === 0) return null;
    const first = rises[0];
    // A promo's rise is a year of the higher price; a renewal is what it costs again.
    const worth = rises.reduce((s, r) => s + r.atStakeCents, 0);
    const weakest = rises.reduce((a, b) => (b.confidence.percent < a.confidence.percent ? b : a));
    return {
      id: suggestionId("price_rises", "promo_ending"),
      capability: "price_rises",
      topic: "promo_ending",
      title:
        rises.length === 1
          ? `Call ${first.name} before ${first.date}, when the price goes up`
          : `${rises.length} prices go up in the next ten weeks: call or switch before they do`,
      headline: `Ask to keep your prices: ${formatWholeDollars(worth)}/yr at stake`,
      short: rises
        .map((r) =>
          r.kind === "promo_end"
            ? `${r.name} intro ends ${r.date}`
            : `${r.name} renews ${r.date} at ${formatCents(r.thenCents)}`,
        )
        .join("; ")
        .slice(0, 120),
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest.confidence,
      urgency: first.daysLeft <= 30 ? "now" : "soon",
      why: `${rises.map((r) => (r.kind === "promo_end" ? `${r.name} has charged ${formatCents(r.nowCents)} a month since it started, likely an intro price ending around ${r.date}; after that it's usually about ${formatCents(r.thenCents)}.` : `${r.name} charged ${formatCents(r.nowCents)} once, about a year ago, so it likely renews around ${r.date}.`)).join(" ")} Calling first usually keeps the price: "${first.kind === "promo_end" ? CALL_SCRIPTS.promo_end : CALL_SCRIPTS.annual_renewal}"`,
      action: { label: "See what's going up", href: "/deadlines" },
    };
  },
};

export const PRICE_RISE_DETECTORS: readonly Detector[] = [promoEnding];
