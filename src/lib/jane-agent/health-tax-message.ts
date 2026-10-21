import type { HealthTaxView } from "@/lib/health-taxes";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";

// The tax side of health insurance in the chat (spec step 269): a Marketplace credit you may
// have to repay, an HSA over its limit, and the answer to "do I have to pay back my subsidy",
// "did I put too much in my HSA", "can I deduct medical costs".

export const HEALTH_HREF = "/taxes/health";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function repaymentMessage(v: HealthTaxView): Message | null {
  const c = v.marketplace.check;
  if (!c || c.repayCents < 30_000) return null;
  const share = Math.round(c.fplShare * 100);
  return {
    body: c.overCliff
      ? `Your income this year is on track for ${share}% of the poverty line, above the 400% line where the Marketplace credit stops. If you take an advance credit, you would repay all of it with your tax return, about ${roundDollars(c.advanceCents)} a year at ${formatCents(v.marketplace.advanceMonthlyCents)} a month. Lowering your income (a retirement contribution counts) or telling the Marketplace your income has risen, so the advance stops, avoids the bill.`
      : `Your income puts you at ${share}% of the poverty line, and the advance credit you take may be more than you're allowed by about ${roundDollars(c.repayCents)}. Telling the Marketplace your income now keeps it from coming back as a bill in April.`,
    refs: { advice: true, taxYear: v.year },
    actions: [{ id: "open", label: "See the numbers", kind: "link", href: HEALTH_HREF }],
  };
}

export function hsaMessage(v: HealthTaxView): Message | null {
  const h = v.hsa;
  if (h.excessCents <= 0) return null;
  return {
    body: `You've put ${formatCents(h.contributedCents)} into your HSA this year, ${formatCents(h.excessCents)} over the ${formatCents(h.limitCents)} limit. Money over the limit is taxed as income and carries a 6% penalty (about ${formatCents(h.exciseCents)}) every year it stays in. Taking the extra out, with what it earned, before you file avoids the penalty. Your HSA provider has a form for it.`,
    refs: { advice: true, taxYear: v.year },
    actions: [{ id: "open", label: "See the numbers", kind: "link", href: HEALTH_HREF }],
  };
}

export function healthReply(v: HealthTaxView): Message {
  const lines: string[] = [];
  const m = v.marketplace;
  if (m.check) {
    lines.push(
      `Marketplace: you pay a premium each month and your income is at ${Math.round(m.check.fplShare * 100)}% of the poverty line. ${
        m.check.overCliff
          ? "That is above 400%, where the credit stops: any advance credit you take is repaid in full."
          : m.check.repayCents > 0
            ? `The advance credit may be about ${formatCents(m.check.repayCents)} too large (repayment is capped at ${formatCents(m.check.capCents ?? 0)}).`
            : "Your advance credit looks in line with your income."
      }${m.told ? "" : " I don't know your advance credit or plan premium, so I used typical amounts; tell me and I'll be exact."}`,
    );
  } else lines.push("Marketplace: I don't see premiums to a Marketplace plan.");
  lines.push(
    v.hsa.contributedCents > 0
      ? `HSA: ${formatCents(v.hsa.contributedCents)} in this year against a limit of ${formatCents(v.hsa.limitCents)}${v.hsa.excessCents > 0 ? `, so ${formatCents(v.hsa.excessCents)} is over` : ": fine"}.`
      : "HSA: I don't see contributions this year.",
  );
  lines.push(
    v.medical.spentCents > 0
      ? `Medical costs: ${formatCents(v.medical.spentCents)} so far. Only what is over ${formatCents(v.medical.floorCents)} (7.5% of your income) counts, and only if you itemize: ${
          v.medical.deductibleCents > 0
            ? `that is ${formatCents(v.medical.deductibleCents)}, ${v.medical.itemizing ? "and you do itemize" : "but the standard deduction is bigger for you, so it won't change your tax"}.`
            : "you're under it."
        }`
      : "Medical costs: none seen this year.",
  );
  return {
    body: `Here is the tax side of your health insurance.\n${lines.map((l) => `• ${l}`).join("\n")}`,
    refs: {},
    actions: [{ id: "open", label: "See the numbers", kind: "link", href: HEALTH_HREF }],
  };
}
