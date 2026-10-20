import { PLAN_TO_AGE } from "@/config/retirement-income";
import type { RetirementIncomeView } from "@/lib/investments/retirement-income";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Income in retirement in the chat (spec step 212): shared words. Past-tense math and the
// person's own plan, always a range, never a promise.

export const RI_LINK: MessageAction = {
  id: "open",
  label: "See your retirement income",
  kind: "link",
  href: "/investments/retirement-income",
};

type View = Pick<
  RetirementIncomeView,
  "ss" | "rmd" | "paycheck" | "spendMonthlyCents" | "retireAge" | "draw" | "balances"
>;

export function ssLine(v: View): string | null {
  const [early, full, late] = v.ss.options;
  if (!early || !full || !late) return null;
  return `Social Security: ${formatCents(early.monthlyCents)} a month if you start at 62, ${formatCents(full.monthlyCents)} at 67, ${formatCents(late.monthlyCents)} at 70 (${v.ss.source === "statement" ? "from your statement" : "an estimate from your pay"}).${v.ss.breakeven62to67 ? ` Waiting from 62 to 67 has paid more in total by about age ${v.ss.breakeven62to67}.` : ""}`;
}

export function paycheckLine(v: View): string | null {
  const p = v.paycheck;
  if (!p) return null;
  const low = Math.min(PLAN_TO_AGE, Math.round(p.lasts.lowAge));
  const high = Math.min(PLAN_TO_AGE, Math.round(p.lasts.highAge));
  return `Spending ${formatCents(v.spendMonthlyCents)} a month from ${v.retireAge}, your money would last to about age ${low}${high > low ? ` to ${high}` : ""} (the plan runs to ${PLAN_TO_AGE}). The most that lasts to ${PLAN_TO_AGE} is ${formatCents(p.sustainableMonthly.lowCents)} to ${formatCents(p.sustainableMonthly.highCents)} a month before tax.`;
}

export const rmdLine = (v: View) =>
  v.rmd
    ? `Required minimum distributions start at ${v.rmd.startAge}${v.rmd.firstYearCents !== null ? `; on today's pre-tax balance the first year's minimum would be about ${formatCents(v.rmd.firstYearCents)}` : ""}.`
    : null;

export const drawLine = (v: View) =>
  v.draw.length > 0
    ? `The order to draw: ${v.draw.map((d, i) => `${i + 1}. ${d.label.split(":")[0].toLowerCase()}`).join(", ")}.`
    : null;
