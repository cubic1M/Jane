import { SS_TAX_MIN_CENTS } from "@/config/retirement-taxes";
import { formatCents } from "@/lib/money";
import type { RetirementTaxView } from "@/lib/retirement-taxes";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";

// Taxes on retirement income in the chat (spec step 271): Social Security's taxable part that
// nothing withholds, Medicare's surcharge line two years ahead, and the answer to "is my Social
// Security taxed", "what's IRMAA", "which account should I take money from". Facts for everyone;
// the tuned order to draw is demo advice.

export const RETIREMENT_PAYCHECK_HREF = "/investments/retirement-income";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const paycheck: MessageAction = {
  id: "open",
  label: "See my retirement paycheck",
  kind: "link",
  href: RETIREMENT_PAYCHECK_HREF,
};

export function ssWithholdingMessage(v: RetirementTaxView): Message | null {
  const tax = Math.round(v.ss.taxableCents * v.bracket);
  if (v.ssDeposits < 3 || tax < SS_TAX_MIN_CENTS) return null;
  return {
    body: `${roundDollars(v.ss.taxableCents)} of your ${roundDollars(v.ssBenefitsCents)} a year of Social Security is taxable at your income: about ${roundDollars(tax)} of tax, which Social Security doesn't withhold unless you ask on Form W-4V (7%, 10%, 12% or 22%).${
      v.ss.extraTaxablePerDollar > 0
        ? ` Each extra dollar from your IRA makes ${Math.round(v.ss.extraTaxablePerDollar * 100)} cents more of it taxable, so that dollar is taxed at about ${pct(v.nextDollarRate)}, not ${pct(v.bracket)}.`
        : ""
    }`,
    refs: { taxYear: v.year },
    actions: [paycheck],
  };
}

export function irmaaMessage(v: RetirementTaxView): Message | null {
  const i = v.irmaa;
  if (!v.nearMedicare || i.nextLineCents === null || i.roomCents === null) return null;
  if (i.nextYearlyCents === null) return null;
  const t = v.tuned;
  const advice =
    v.advice && t.preTaxCapCents !== null
      ? ` To stay under it, keep pre-tax withdrawals and conversions this year under about ${roundDollars(t.preTaxCapCents)}, and take the rest from taxable accounts, then Roth.`
      : "";
  return {
    body: `Your income this year sets your Medicare premiums in ${i.premiumYear}. At about ${roundDollars(v.magiCents)}, you're ${roundDollars(i.roomCents)} under the line at ${roundDollars(i.nextLineCents)}${i.estimated ? " (estimated from this year's)" : ""}; over it, Part B and D cost about ${roundDollars(i.nextYearlyCents)} a year more${v.people === 2 ? " for the two of you" : ""}.${advice}`,
    refs: v.advice && advice ? { advice: true, taxYear: v.year } : { taxYear: v.year },
    actions: [paycheck],
  };
}

export function retirementReply(v: RetirementTaxView): Message {
  const lines: string[] = [];
  lines.push(
    v.ssBenefitsCents > 0
      ? `Social Security: ${formatCents(v.ssBenefitsCents)} a year, and with ${formatCents(v.otherIncomeCents)} of other income, ${formatCents(v.ss.taxableCents)} of it is taxable (${pct(v.ssBenefitsCents ? v.ss.taxableCents / v.ssBenefitsCents : 0)}).${v.ss.extraTaxablePerDollar > 0 ? ` Your next IRA dollar makes ${Math.round(v.ss.extraTaxablePerDollar * 100)} cents more taxable: about ${pct(v.nextDollarRate)} on it, not ${pct(v.bracket)}.` : ""}`
      : "Social Security: I don't see it coming in yet. When it does, up to 85% of it is taxable once your other income passes the line.",
  );
  const i = v.irmaa;
  lines.push(
    `Medicare's surcharge: this year's income of about ${formatCents(v.magiCents)} sets your ${i.premiumYear} premiums. ${
      i.tier > 0
        ? `That's tier ${i.tier}: about ${formatCents(i.monthlyPerPersonCents)} a month more each for Part B and D.`
        : "That's under the first line: no surcharge."
    }${i.nextLineCents !== null && i.roomCents !== null ? ` The next line is ${formatCents(i.nextLineCents)}${i.estimated ? " (estimated)" : ""}, ${formatCents(i.roomCents)} away.` : ""}`,
  );
  if (v.advice) {
    const t = v.tuned;
    lines.push(
      t.preTaxCapCents !== null
        ? `The order to draw, tuned for taxes: taxable accounts first, then pre-tax accounts up to about ${formatCents(t.preTaxCapCents)} this year (that keeps you under the line), then Roth.`
        : "The order to draw: taxable accounts, then pre-tax, then Roth.",
    );
  }
  return {
    body: `Here is how your retirement income is taxed.\n${lines.map((l) => `• ${l}`).join("\n")}`,
    refs: v.advice ? { advice: true, taxYear: v.year } : { taxYear: v.year },
    actions: [paycheck],
  };
}
