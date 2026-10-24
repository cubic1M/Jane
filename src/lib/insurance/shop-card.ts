import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { PolicyKind } from "@/config/insurance";
import { kindWords } from "@/lib/insurance/gaps";
import { formatCents } from "@/lib/money";
import { MAX_CARD_OPTIONS, type CardOption, type OfferedOptions } from "@/lib/option-card";
import type { StoredQuote } from "./quotes";
import type { Shop } from "./shop";

// A reshop (spec step 104) as the shared pick-one card (src/lib/option-card.ts): Jane's pick
// first, then the other quotes that also cost less than what the person pays now, so they
// can switch to any of them with a tap (option.pick, src/lib/jane-agent/actions/options.ts,
// through acceptShop). The topic names the shop: "switch:<shop id>". Shops exist only in demo
// advice mode, so the pick and the label always show. Pure.

export const SWITCH_TOPIC = "switch:";
export const shopIdOf = (topic: string) =>
  topic.startsWith(SWITCH_TOPIC) ? topic.slice(SWITCH_TOPIC.length) : null;

// What switching to a quote saves a year (negative: it costs more).
export const savingOf = (shop: Shop, q: StoredQuote) =>
  shop.currentAnnualCents - q.annualPremiumCents;

function optionOf(shop: Shop, q: StoredQuote, isPick: boolean): CardOption {
  const saving = savingOf(shop, q);
  const cover = q.sameCover
    ? "Same cover and deductible"
    : `Different cover: ${q.differences.join("; ")}`;
  return {
    id: q.id,
    label: q.carrier.name,
    headline: `${q.carrier.name}, ${formatCents(q.annualPremiumCents)} a year`,
    priceCents: q.annualPremiumCents,
    pricePeriod: "year",
    facts: [
      `Saves: ${formatCents(saving)} a year`,
      `Rated: ${q.carrier.rating}`,
      ...(q.deductibleCents !== null ? [`Deductible: ${formatCents(q.deductibleCents)}`] : []),
      cover,
    ],
    whyThisOne:
      isPick && shop.why[0]
        ? shop.why[0]
        : `${formatCents(saving)} a year less than you pay now${q.sameCover ? ", same cover" : ", but not the same cover"}.`,
    isPick,
    details: [
      ...(isPick ? shop.why.slice(1) : q.differences),
      ...(q.demo ? ["A sample quote from the demo carrier catalog, not a real offer."] : []),
      ...(isPick ? [DEMO_ADVICE_LABEL] : []),
    ],
  };
}

// Null when there's nothing to pick: the shop isn't open, or it has no pick.
export function shopCard(
  shop: Shop,
  policy: { carrier: string; kind: PolicyKind },
): OfferedOptions | null {
  if (shop.status !== "open" || !shop.pick) return null;
  const others = shop.runnersUp
    .filter((q) => q.id !== shop.pick!.id && savingOf(shop, q) > 0)
    .sort((a, b) => a.annualPremiumCents - b.annualPremiumCents);
  return {
    kind: "insurance",
    title: `Switch your ${policy.carrier} ${kindWords(policy.kind)}`,
    topic: `${SWITCH_TOPIC}${shop.id}`,
    newCover: false,
    advice: true,
    options: [shop.pick, ...others]
      .slice(0, MAX_CARD_OPTIONS)
      .map((q, i) => optionOf(shop, q, i === 0)),
  };
}
