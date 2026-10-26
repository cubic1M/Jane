import {
  CARD_BETTER_MIN_CENTS,
  CARD_SPEND_DAYS,
  CARD_SPEND_FULL_DAYS,
  NOT_CARD_SPENDING_DETAILED,
  NOT_CARD_SPENDING_PRIMARIES,
  REWARD_CATEGORIES,
  REWARD_CATEGORY_OF_DETAILED,
  REWARD_CATEGORY_OF_PRIMARY,
  type RewardCategory,
} from "@/config/credit-cards";
import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";
import { kindOf, type InsightTransaction } from "@/insights/spending";
import type { CardProduct } from "@/lib/credit-cards/partner";
import { DAY_MS } from "@/lib/dates";

// The right card for each purchase (spec step 174). Pure: the person's own spending and
// the cards' terms in; what each card earns on that spending, its fee always taken off,
// which card to use for each kind of spending, and a card that would earn more, out.

export type Spend = Record<RewardCategory, number>;

const zero = (): Spend => Object.fromEntries(REWARD_CATEGORIES.map((c) => [c, 0])) as Spend;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

// The kind of spending a purchase is, or null when a card can't earn on it.
export function rewardCategoryOf(
  t: Pick<InsightTransaction, "pfcPrimary" | "pfcDetailed">,
): RewardCategory | null {
  if (t.pfcPrimary && NOT_CARD_SPENDING_PRIMARIES.includes(t.pfcPrimary as PfcPrimary)) {
    return null;
  }
  if (t.pfcDetailed && NOT_CARD_SPENDING_DETAILED.includes(t.pfcDetailed as PfcDetailed)) {
    return null;
  }
  return (
    REWARD_CATEGORY_OF_DETAILED[t.pfcDetailed as PfcDetailed] ??
    REWARD_CATEGORY_OF_PRIMARY[t.pfcPrimary as PfcPrimary] ??
    "other"
  );
}

export type YearSpend = {
  // A year of spending by kind: the last CARD_SPEND_DAYS, scaled up to a year when the
  // history is shorter than CARD_SPEND_FULL_DAYS. Refunds net against their kind.
  byCategory: Spend;
  totalCents: number;
  // Days of history it's based on.
  days: number;
};

export function yearSpend(transactions: readonly InsightTransaction[], asOf: string): YearSpend {
  const end = dayNumber(asOf);
  const start = end - CARD_SPEND_DAYS;
  const byCategory = zero();
  let first = end;
  for (const t of transactions) {
    const day = dayNumber(t.date);
    if (day <= start || day > end || kindOf(t) !== "spending") continue;
    const category = rewardCategoryOf(t);
    if (!category) continue;
    byCategory[category] += t.amountCents;
    first = Math.min(first, day);
  }
  const days = Math.max(1, Math.round(end - first + 1));
  const scale = days >= CARD_SPEND_FULL_DAYS ? 1 : CARD_SPEND_DAYS / days;
  for (const c of REWARD_CATEGORIES) byCategory[c] = Math.max(0, Math.round(byCategory[c] * scale));
  return {
    byCategory,
    totalCents: REWARD_CATEGORIES.reduce((sum, c) => sum + byCategory[c], 0),
    days: Math.min(days, CARD_SPEND_DAYS),
  };
}

export const rateOf = (card: CardProduct, category: RewardCategory) =>
  card.rateBps[category] ?? card.baseRateBps;

// What a card would earn in a year if all of this spending went on it.
export function earnsCents(card: CardProduct, spend: Spend): number {
  return REWARD_CATEGORIES.reduce(
    (sum, c) => sum + Math.round((spend[c] * rateOf(card, c)) / 10_000),
    0,
  );
}

export type WalletPick = {
  category: RewardCategory;
  cardId: string;
  rateBps: number;
  earnsCents: number;
};

export type Wallet = {
  // For each kind of spending, the card that earns most on it.
  picks: WalletPick[];
  earnsCents: number;
  feesCents: number;
  // Rewards less every annual fee.
  netCents: number;
};

// Using the best of these cards for each kind of spending. Ties go to the card without a
// fee, then the first listed.
export function wallet(cards: readonly CardProduct[], spend: Spend): Wallet {
  const picks: WalletPick[] = [];
  if (cards.length > 0) {
    for (const category of REWARD_CATEGORIES) {
      const best = [...cards].sort(
        (a, b) => rateOf(b, category) - rateOf(a, category) || a.annualFeeCents - b.annualFeeCents,
      )[0];
      picks.push({
        category,
        cardId: best.id,
        rateBps: rateOf(best, category),
        earnsCents: Math.round((spend[category] * rateOf(best, category)) / 10_000),
      });
    }
  }
  const earned = picks.reduce((sum, p) => sum + p.earnsCents, 0);
  const fees = cards.reduce((sum, c) => sum + c.annualFeeCents, 0);
  return { picks, earnsCents: earned, feesCents: fees, netCents: earned - fees };
}

export type FeeCheck = {
  cardId: string;
  feeCents: number;
  // What it earns on the person's spending, with the fee taken off.
  earnsCents: number;
  netCents: number;
  // The no-fee card that would earn most on the same spending, and what it would earn.
  noFee: { card: CardProduct; earnsCents: number } | null;
  paysForItself: boolean;
};

// Whether a card's annual fee pays for itself: what it earns less the fee, against the
// best card without a fee on the same spending.
export function feeCheck(
  card: CardProduct,
  spend: Spend,
  catalog: readonly CardProduct[],
): FeeCheck | null {
  if (card.annualFeeCents <= 0) return null;
  const earned = earnsCents(card, spend);
  const noFee =
    catalog
      .filter((c) => c.annualFeeCents === 0)
      .map((c) => ({ card: c, earnsCents: earnsCents(c, spend) }))
      .sort((a, b) => b.earnsCents - a.earnsCents)[0] ?? null;
  const net = earned - card.annualFeeCents;
  return {
    cardId: card.id,
    feeCents: card.annualFeeCents,
    earnsCents: earned,
    netCents: net,
    noFee,
    paysForItself: noFee === null || net >= noFee.earnsCents,
  };
}

export type BetterCard = {
  card: CardProduct;
  // A year's rewards more than the person's cards earn now, after the new card's fee.
  gainCents: number;
  // The kinds of spending it would be used for.
  usedFor: RewardCategory[];
  // Whether the person's usual spending reaches the sign-up bonus in time.
  introReachable: boolean;
};

// Cards from the catalog that would add at least CARD_BETTER_MIN_CENTS a year to the
// person's cards, the best first. A card they have already is never offered.
export function betterCards(
  own: readonly CardProduct[],
  catalog: readonly CardProduct[],
  spend: Spend,
  totalCents: number,
): BetterCard[] {
  const now = wallet(own, spend).netCents;
  const owned = new Set(own.map((c) => c.id));
  return catalog
    .filter((c) => !owned.has(c.id))
    .map((card) => {
      const withIt = wallet([...own, card], spend);
      return {
        card,
        gainCents: withIt.netCents - now,
        // Only where it earns more than their cards do now, not where it ties.
        usedFor: withIt.picks
          .filter(
            (p) =>
              p.cardId === card.id &&
              spend[p.category] > 0 &&
              !own.some((o) => rateOf(o, p.category) >= p.rateBps),
          )
          .map((p) => p.category),
        introReachable:
          card.intro !== null && (totalCents / 12) * card.intro.months >= card.intro.spendCents,
      };
    })
    .filter((b) => b.gainCents >= CARD_BETTER_MIN_CENTS)
    .sort((a, b) => b.gainCents - a.gainCents || a.card.id.localeCompare(b.card.id));
}
