import { REWARD_CATEGORY_LABELS, type RewardCategory } from "@/config/credit-cards";
import type { CreditCards } from "@/lib/credit-cards";
import { formatCents } from "@/lib/money";
import type { BetterCard } from "@/planning/credit-cards";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about credit card rewards (spec step 174), from src/lib/credit-cards.ts.
// Pure. Only demo-bank people have a catalog, so every pick is demo advice and labelled.

export const CARDS_PAGE: MessageAction = {
  id: "open",
  label: "See your cards",
  kind: "link",
  href: "/loans/cards",
};

export const pct = (bps: number) => `${Math.round(bps) / 100}%`;
const lower = (c: RewardCategory) => REWARD_CATEGORY_LABELS[c].toLowerCase();

// The one-tap application: the label says it's a real application with a hard check. The
// card goes in the message's refs (creditCard).
export function applyButton(b: BetterCard): MessageAction {
  return {
    id: "credit_card.apply",
    label: `Apply for the ${b.card.name} (hard credit check)`,
    kind: "primary",
  };
}

// "Fern Flat 2% (no annual fee) adds about $130 a year after its fee: use it for groceries,
// gas and everything else."
export function betterLine(b: BetterCard): string {
  const fee =
    b.card.annualFeeCents > 0
      ? `a ${formatCents(b.card.annualFeeCents)} annual fee`
      : "no annual fee";
  const intro =
    b.card.intro && b.introReachable
      ? ` Its ${formatCents(b.card.intro.bonusCents)} sign-up bonus (after ${formatCents(b.card.intro.spendCents)} in ${b.card.intro.months} months) is within your usual spending, on top.`
      : "";
  return `The ${b.card.name} from ${b.card.issuer} (${fee}) would add about ${formatCents(b.gainCents)} a year after its fee, used for ${b.usedFor.map(lower).join(", ")}.${intro}`;
}

// Which of the person's cards to use for a kind of spending, and what it earns there.
export function cardFor(cards: CreditCards, category: RewardCategory) {
  const pick = cards.wallet.picks.find((p) => p.category === category);
  if (!pick) return null;
  const card = cards.cards.find((c) => c.product?.id === pick.cardId)!;
  return { card, rateBps: pick.rateBps, earnsCents: pick.earnsCents };
}

const unavailable: Reply = {
  body: "Card rewards come from a card partner, and there isn't one for your accounts yet. Until there is, I can't say what each card earns.",
  actions: [],
  refs: {},
};

// "Which card should I use for groceries?" With no kind given, every kind.
export function cardForReply(cards: CreditCards, category: RewardCategory | null): Reply {
  if (!cards.available) return unavailable;
  if (cards.wallet.picks.length === 0) {
    return {
      body: "I don't know your cards' rewards yet, so I can't say which one earns more. Once I do, I'll tell you which to use for each kind of spending.",
      actions: [CARDS_PAGE],
      refs: { advice: true },
    };
  }
  if (category) {
    const pick = cardFor(cards, category)!;
    return {
      body: `Use your ${pick.card.name} for ${lower(category)}: it earns ${pct(pick.rateBps)}, about ${formatCents(pick.earnsCents)} a year on your ${formatCents(cards.spend.byCategory[category])} of ${lower(category)}.`,
      actions: [CARDS_PAGE],
      refs: { advice: true },
    };
  }
  const lines = cards.wallet.picks
    .filter((p) => cards.spend.byCategory[p.category] > 0)
    .map((p) => {
      const card = cards.cards.find((c) => c.product?.id === p.cardId)!;
      return `- ${REWARD_CATEGORY_LABELS[p.category]}: your ${card.name}, ${pct(p.rateBps)}`;
    });
  return {
    body: [
      `Your cards earn about ${formatCents(cards.wallet.earnsCents)} a year on your spending, ${formatCents(cards.wallet.netCents)} after ${formatCents(cards.wallet.feesCents)} in annual fees. The card to use for each:`,
      ...lines,
    ].join("\n"),
    actions: [CARDS_PAGE],
    refs: { advice: true },
  };
}

// "Is my annual fee worth it?"
export function cardFeeReply(cards: CreditCards): Reply {
  if (!cards.available) return unavailable;
  const withFee = cards.cards.filter((c) => c.fee);
  if (withFee.length === 0) {
    return {
      body: "None of your cards has an annual fee I know of, so there's nothing to pay for itself.",
      actions: [CARDS_PAGE],
      refs: { advice: true },
    };
  }
  const lines = withFee.map((c) => {
    const f = c.fee!;
    const verdict = f.paysForItself
      ? "It pays for itself."
      : `It doesn't pay for itself: the ${f.noFee!.card.name}, with no fee, would earn ${formatCents(f.noFee!.earnsCents)} on the same spending.`;
    return `Your ${c.name} earns about ${formatCents(f.earnsCents)} a year on your spending, ${formatCents(f.netCents)} after its ${formatCents(f.feeCents)} fee. ${verdict}`;
  });
  const better = cards.better[0];
  return {
    body: lines.join("\n"),
    actions: better ? [applyButton(better), CARDS_PAGE] : [CARDS_PAGE],
    refs: better ? { advice: true, creditCard: { productId: better.card.id } } : { advice: true },
  };
}

// "What's the best credit card for me?"
export function betterCardReply(cards: CreditCards): Reply {
  if (!cards.available) return unavailable;
  const [best, ...others] = cards.better;
  if (!best) {
    return {
      body: `Your cards already earn about as much as any I can find on your spending: ${formatCents(cards.wallet.netCents)} a year after fees. No card would add at least the amount I'd switch for.`,
      actions: [CARDS_PAGE],
      refs: { advice: true },
    };
  }
  const also = others.length
    ? `\nAlso: ${others.map((o) => `the ${o.card.name}, about ${formatCents(o.gainCents)} a year`).join("; ")}.`
    : "";
  return {
    body: `${betterLine(best)} That's from your own spending over the last year, fee counted. Applying is a hard credit check.${also}`,
    actions: [applyButton(best), CARDS_PAGE],
    refs: { advice: true, creditCard: { productId: best.card.id } },
  };
}
