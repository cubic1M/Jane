import { IRS_CARD_PAYMENTS } from "@/config/tax";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/percent";

// What paying the IRS by card costs (connectors roadmap round 16, irs_card_fee_check): each
// processor's fee on this amount, the cheaper first (by fee alone; neither pays Jane), next to
// what the card's rewards would earn on it. Bank payment through Direct Pay is free. Arithmetic,
// not a pick: the person decides. Pure.

export type CardFeeCheck = {
  fees: { processor: string; feeCents: number }[];
  rewardsCents: number;
  // Rewards less the cheaper fee: below zero, paying by card costs more than it earns.
  netCents: number;
  lines: string[];
};

export function irsCardFee(input: {
  amountCents: number;
  card: "debit" | "credit";
  // The card's rewards rate, in basis points (150 = 1.5% back); 0 when it earns none.
  rewardsBps: number;
}): CardFeeCheck {
  const amount = Math.max(0, Math.round(input.amountCents));
  const fees = IRS_CARD_PAYMENTS.processors
    .map((p) => ({
      processor: p.name,
      feeCents:
        input.card === "debit"
          ? p.debitFeeCents
          : Math.max(p.creditMinCents, Math.round((amount * p.creditFeeBps) / 10_000)),
    }))
    .sort((a, b) => a.feeCents - b.feeCents || a.processor.localeCompare(b.processor));
  const rewardsCents = Math.round((amount * Math.max(0, input.rewardsBps)) / 10_000);
  const netCents = rewardsCents - fees[0]!.feeCents;
  return {
    fees,
    rewardsCents,
    netCents,
    lines: [
      `Paying ${formatCents(amount)} by ${input.card} card: ${fees.map((f) => `${f.processor} charges ${formatCents(f.feeCents)}`).join(", ")} (as of ${IRS_CARD_PAYMENTS.asOf}).`,
      input.rewardsBps > 0
        ? `Your card's ${formatRate(input.rewardsBps)} back earns ${formatCents(rewardsCents)} on it, so it comes to ${netCents >= 0 ? `${formatCents(netCents)} ahead` : `${formatCents(-netCents)} behind`} after the lower fee.`
        : "Your card earns nothing back on it, so the fee is the whole cost.",
      "Paying from your bank through IRS Direct Pay costs nothing.",
      `Estimated tax can be paid by card at most ${IRS_CARD_PAYMENTS.estimatedPerQuarter} times a quarter.`,
    ],
  };
}
