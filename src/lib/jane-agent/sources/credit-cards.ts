import { REWARD_CATEGORY_LABELS } from "@/config/credit-cards";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { CARDS_PAGE, applyButton, betterLine, pct } from "../credit-card-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// The right card for each purchase (spec step 174). Jane brings up an annual fee that
// doesn't pay for itself on the person's spending and a card that would earn more (with
// one tap to apply), each once a year; and, from "Handle the safe stuff", which card to use
// for each kind of spending whenever that changes. All demo advice, labelled.

export const creditCardsSource: MessageSource = {
  key: "credit_cards",
  gather: (snapshot): Candidate[] => {
    const cards = snapshot.creditCards;
    if (!cards?.available || cards.firstLook) return [];
    const year = cards.asOf.slice(0, 4);
    const out: Candidate[] = [];
    const best = cards.better[0];
    for (const card of cards.cards) {
      const fee = card.fee;
      if (!fee || fee.paysForItself || !fee.noFee) continue;
      out.push({
        kind: "heads_up",
        body: `Your ${card.name}'s ${formatCents(fee.feeCents)} annual fee doesn't pay for itself: it earns about ${formatCents(fee.earnsCents)} a year on your spending, ${formatCents(fee.netCents)} after the fee. The ${fee.noFee.card.name}, with no fee, would earn ${formatCents(fee.noFee.earnsCents)} on the same spending.`,
        refs: best ? { advice: true, creditCard: { productId: best.card.id } } : { advice: true },
        actions: [...(best ? [applyButton(best)] : []), CARDS_PAGE, snoozeButton()],
        dedupeKey: `fee:${fee.cardId}:${year}`,
        priority: MESSAGE_PRIORITY.card_fee,
      });
    }
    if (best && out.length === 0) {
      out.push({
        kind: "decision",
        body: `${betterLine(best)} That's from your own spending over the last year, fee counted. Applying is a hard credit check, so it's only ever your tap.`,
        refs: { advice: true, creditCard: { productId: best.card.id } },
        actions: [applyButton(best), CARDS_PAGE, snoozeButton()],
        dedupeKey: `better:${best.card.id}:${year}`,
        priority: MESSAGE_PRIORITY.card_better,
      });
    }
    // From "Handle the safe stuff": which card for what, once for each set of cards.
    const used = cards.wallet.picks.filter((p) => cards.spend.byCategory[p.category] > 0);
    if (cards.level !== "ask" && cards.cards.filter((c) => c.product).length > 1 && used.length) {
      const name = (id: string) => cards.cards.find((c) => c.product?.id === id)!.name;
      out.push({
        kind: "done",
        body: [
          "I've worked out which card to use for each kind of spending:",
          ...used.map(
            (p) => `- ${REWARD_CATEGORY_LABELS[p.category]}: ${name(p.cardId)}, ${pct(p.rateBps)}`,
          ),
        ].join("\n"),
        refs: { advice: true },
        actions: [CARDS_PAGE],
        dedupeKey: `picks:${used.map((p) => `${p.category}=${p.cardId}`).join(",")}`,
        priority: MESSAGE_PRIORITY.card_picks,
      });
    }
    return out;
  },
};
