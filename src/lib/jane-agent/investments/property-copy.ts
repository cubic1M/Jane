import type { PropertyView } from "@/lib/investments/property";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Property in the chat (spec step 214): shared words. Both sides of the paydown question
// are always given; a rental's figures are the person's own transactions.

export const PROPERTY_LINK: MessageAction = {
  id: "open",
  label: "See your property",
  kind: "link",
  href: "/investments/property",
};

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 1000) / 10}%`);

export const homeLine = (h: PropertyView["homes"][number]) =>
  `${h.name} is worth ${formatCents(h.valueCents)} (your value)${h.loanCents !== null ? ` and you owe ${formatCents(h.loanCents)}` : ""}, so your equity is ${formatCents(h.equityCents)}.`;

export const rentalLine = (r: PropertyView["rentals"][number]) =>
  `${r.name}, last 12 months: rent ${formatCents(r.figures.rentCents)} from ${r.counts.rent} deposits, cash flow ${formatCents(r.figures.cashFlowCents)} (${pct(r.figures.cashOnCash)} on the ${formatCents(r.cashInvestedCents)} you put in), taxable profit ${formatCents(r.figures.taxableCents)} after ${formatCents(r.figures.depreciationCents)} of depreciation.`;

export const paydownLine = (p: NonNullable<PropertyView["paydown"]>) =>
  `An extra ${formatCents(p.extraMonthlyCents)} a month for ${p.years} years: paying down ${p.homeName} (${pct(p.rateBps / 10_000)}) saves about ${formatCents(p.paydown.interestSavedCents)} in interest for certain; investing it could grow by about ${formatCents(p.invest.lowGainCents)} to ${formatCents(p.invest.highGainCents)}, with no guarantee. ${
    p.verdict === "paydown"
      ? "The mortgage rate is above the top of the assumed investing range, so paying it down looks better."
      : p.verdict === "invest"
        ? "The mortgage rate is below the bottom of the assumed investing range, so investing looks better."
        : "The rate sits inside the investing range, so it comes down to how much risk you want."
  }`;
