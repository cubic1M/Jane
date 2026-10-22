import type { BusinessView } from "@/lib/business-structure";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";

// Business owners' tax structure in the chat (spec step 267): whether an S corporation would
// save more than it costs at this profit (demo advice), and the answer to "should I be an S
// corp", "what's my QBI deduction".

export const BUSINESS_HREF = "/taxes/business";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function sCorpMessage(v: BusinessView): Message | null {
  const s = v.structure?.sCorp;
  if (!v.advice || !s?.worthIt) return null;
  return {
    body: `At your profit of ${roundDollars(v.structure!.profitCents)}, running your business as an S corporation could save about ${roundDollars(s.savesCents)} a year in tax after about ${roundDollars(s.costsCents)} of payroll and filing costs. You'd pay yourself a salary (a range to start from is ${roundDollars(s.salaryLowCents)} to ${roundDollars(s.salaryHighCents)}) and take the rest as profit, which skips the self-employment tax. A tax professional should confirm it and set up the election.`,
    refs: { advice: true, taxYear: v.year },
    actions: [
      { id: "open", label: "See the numbers", kind: "link", href: BUSINESS_HREF },
      { id: "open", label: "Share with my accountant", kind: "link", href: "/taxes/accountant" },
    ],
  };
}

export function businessReply(v: BusinessView): Message {
  if (!v.structure) {
    return {
      body: "I don't see profit from self-employment this year, so there's nothing to compare yet. When business income shows up in your accounts, I'll work out your qualified business income deduction and whether an S corporation would save you tax.",
      refs: {},
      actions: [{ id: "open", label: "See business taxes", kind: "link", href: BUSINESS_HREF }],
    };
  }
  const { sole, sCorp, profitCents } = v.structure;
  const lines = [
    `Profit so far, projected: ${formatCents(profitCents)}.`,
    sole.qbiLimited
      ? "Your income is above where the 20% qualified business income deduction is simple; I don't work it out above that line."
      : `Your qualified business income deduction is about ${formatCents(sole.qbiCents)}, which lowers your tax by roughly ${formatCents(sole.qbiSavesCents)}.`,
    `As you are (a sole proprietor), your federal tax is about ${formatCents(sole.taxCents)}.`,
  ];
  if (v.advice) {
    lines.push(
      sCorp.worthIt
        ? `As an S corporation with a salary of about ${formatCents(sCorp.salaryCents)} it would be about ${formatCents(sCorp.totalCents)} including the payroll tax and ${formatCents(sCorp.costsCents)} of costs: about ${formatCents(sCorp.savesCents)} less.`
        : `An S corporation wouldn't save enough after its costs at this profit (${sCorp.savesCents >= 0 ? `about ${formatCents(sCorp.savesCents)}` : `it would cost about ${formatCents(-sCorp.savesCents)} more`}).`,
    );
  }
  lines.push(
    v.homeOffice.sqft
      ? `Home office: ${v.homeOffice.sqft} sq ft on file, a ${formatCents(v.homeOffice.deductionCents)} deduction.`
      : "Home office: none on file.",
  );
  lines.push(
    v.mileage.miles > 0
      ? `Business miles this year: ${v.mileage.miles}, a ${formatCents(v.mileage.deductionCents)} deduction.`
      : "Business miles: none logged.",
  );
  return {
    body: `Here is where your business taxes stand.\n${lines.map((l) => `• ${l}`).join("\n")}`,
    refs: v.advice ? { advice: true } : {},
    actions: [{ id: "open", label: "See business taxes", kind: "link", href: BUSINESS_HREF }],
  };
}
