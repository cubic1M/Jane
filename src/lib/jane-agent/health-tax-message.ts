import { PTC_MIN_REPAY_CENTS, MEDICAL_MIN_SAVING_CENTS } from "@/config/health-taxes";
import type { HealthTaxView } from "@/lib/health-taxes";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";

// The tax side of health insurance in the chat (spec step 269): a Marketplace credit that may
// come back as a bill, an HSA over its limit, a year of care worth itemizing, and the answer to
// "do I have to pay back my subsidy", "did I put too much in my HSA", "can I deduct medical
// bills". The rules are facts for everyone; what to do about them is demo advice.

export const HEALTH_HREF = "/taxes/health";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const see: MessageAction = {
  id: "open",
  label: "See the numbers",
  kind: "link",
  href: HEALTH_HREF,
};

const people = (n: number) => (n === 1 ? "one person" : `${n} people`);

export function repaymentMessage(v: HealthTaxView): Message | null {
  const c = v.marketplace.check;
  if (!c || c.repayCents < PTC_MIN_REPAY_CENTS) return null;
  const share = Math.round(c.fplShare * 100);
  const facts = `Your income has gone up since the start of the year: it's on pace for about ${roundDollars(v.pace.projectedCents)}, ${share}% of the poverty line for ${people(v.householdSize)}. ${
    c.overCliff
      ? "Over 400% the Marketplace credit stops, so every advance dollar is repaid with your return"
      : `At that income the credit is about ${roundDollars(c.allowedCents)}`
  }: about ${roundDollars(c.repayCents)} against ${roundDollars(c.advanceCents)} paid in advance${v.marketplace.told ? "" : " (I worked the advance out from your income early in the year; tell me yours and I'll be exact)"}. From 2026 there is no cap on paying it back.`;
  return {
    body: v.advice
      ? `${facts} Updating your income on the Marketplace now lowers the advance for the rest of the year, and a pre-tax retirement contribution lowers the income it's judged on.`
      : facts,
    refs: v.advice ? { advice: true, taxYear: v.year } : { taxYear: v.year },
    actions: [see],
  };
}

export function hsaMessage(v: HealthTaxView): Message | null {
  const h = v.hsa;
  if (h.deposits === 0 || h.projectedExcessCents <= 0) return null;
  const over = h.excessCents > 0;
  return {
    body: `You've put ${formatCents(h.contributedCents)} into your HSA this year${over ? `, ${formatCents(h.excessCents)} over` : `, and at this pace about ${formatCents(h.projectedCents)} by December, ${formatCents(h.projectedExcessCents)} over`} the ${formatCents(h.limitCents)} limit for ${h.family ? "family" : "self-only"} cover. Money over the limit isn't deductible and costs a 6% penalty (about ${formatCents(h.exciseCents)}) every year it stays in; taken out with what it earned before you file, there's no penalty. Your HSA provider has a form for a "return of excess contribution".`,
    refs: { taxYear: v.year },
    actions: [see],
  };
}

export function medicalMessage(v: HealthTaxView): Message | null {
  const m = v.medical;
  if (m.savesCents < MEDICAL_MIN_SAVING_CENTS) return null;
  return {
    body: `You've paid ${formatCents(m.spentCents)} for care and health premiums this year. Medical costs count only over 7.5% of your income (about ${formatCents(m.floorCents)}), which leaves ${formatCents(m.deductibleCents)}; with your other deductions that's more than your ${formatCents(m.standardCents)} standard deduction, so itemizing saves about ${formatCents(m.savesCents)}. Keep the bills and receipts for whoever does your return.`,
    refs: { taxYear: v.year },
    actions: [see],
  };
}

export function healthReply(v: HealthTaxView): Message {
  const lines: string[] = [];
  const mk = v.marketplace;
  if (mk.check) {
    const c = mk.check;
    lines.push(
      `Marketplace credit: your income is on pace for ${formatCents(v.pace.projectedCents)}, ${Math.round(c.fplShare * 100)}% of the poverty line for ${people(v.householdSize)}. ${
        c.overCliff
          ? "That's over 400%, where the credit stops: an advance credit is repaid in full."
          : c.repayCents > 0
            ? `The credit at that income is ${formatCents(c.allowedCents)}, so about ${formatCents(c.repayCents)} of the ${formatCents(c.advanceCents)} advance would be repaid.`
            : `The credit at that income (${formatCents(c.allowedCents)}) covers the ${formatCents(c.advanceCents)} advance.`
      }${mk.told ? "" : " I worked your advance credit out from your income early in the year; tell me yours and I'll be exact."}`,
    );
  } else if (mk.payments > 0) {
    lines.push(
      "Marketplace credit: you pay a Marketplace premium, and your income doesn't point to an advance credit to repay.",
    );
  } else lines.push("Marketplace credit: I don't see premiums to a Marketplace plan this year.");
  const h = v.hsa;
  lines.push(
    h.deposits > 0
      ? `HSA: ${formatCents(h.contributedCents)} in this year (about ${formatCents(h.projectedCents)} by December at this pace) against the ${formatCents(h.limitCents)} ${h.family ? "family" : "self-only"} limit${h.projectedExcessCents > 0 ? `: ${formatCents(Math.max(h.excessCents, h.projectedExcessCents))} over, which costs a 6% penalty each year it stays in unless it's taken out before you file` : `, ${formatCents(h.roomCents)} of room left`}.`
      : "HSA: I don't see deposits to one this year.",
  );
  const m = v.medical;
  lines.push(
    m.spentCents > 0
      ? `Medical costs: ${formatCents(m.spentCents)} so far, including health premiums. Only what's over ${formatCents(m.floorCents)} (7.5% of your income) counts, and only if you itemize: ${
          m.deductibleCents === 0
            ? `you're ${formatCents(m.toFloorCents)} under it.`
            : m.itemizing
              ? `that's ${formatCents(m.deductibleCents)}, and itemizing beats your ${formatCents(m.standardCents)} standard deduction by enough to save about ${formatCents(m.savesCents)}.`
              : `that's ${formatCents(m.deductibleCents)}, but your ${formatCents(m.standardCents)} standard deduction is still bigger, so it won't change your tax.`
        }`
      : "Medical costs: none seen this year.",
  );
  return {
    body: `Here is the tax side of your health cover.\n${lines.map((l) => `• ${l}`).join("\n")}`,
    refs: { taxYear: v.year },
    actions: [see],
  };
}
