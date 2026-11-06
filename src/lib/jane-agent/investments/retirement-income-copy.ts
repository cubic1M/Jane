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
  "ss" | "rmd" | "paycheck" | "spendMonthlyCents" | "spendFrom" | "retireAge" | "draw" | "balances"
>;

export function ssLine(v: View): string | null {
  if (v.ss.source === "deposits" && v.ss.fullMonthlyCents !== null)
    return `Social Security: ${formatCents(v.ss.fullMonthlyCents)} a month coming in now (from the deposits in your account).`;
  const [early, full, late] = v.ss.options;
  if (!early || !full || !late) return null;
  return `Social Security: ${formatCents(early.monthlyCents)} a month if you start at 62, ${formatCents(full.monthlyCents)} at 67, ${formatCents(late.monthlyCents)} at 70 (${v.ss.source === "statement" ? "from your statement" : "an estimate from your pay"}).${v.ss.breakeven62to67 ? ` Waiting from 62 to 67 has paid more in total by about age ${v.ss.breakeven62to67}.` : ""}`;
}

export function paycheckLine(v: View): string | null {
  const p = v.paycheck;
  if (!p) return null;
  const low = Math.min(PLAN_TO_AGE, Math.round(p.lasts.lowAge));
  const high = Math.min(PLAN_TO_AGE, Math.round(p.lasts.highAge));
  return `Spending ${formatCents(v.spendMonthlyCents)} a month${v.spendFrom === "spending" ? " (what you spend in a typical month now)" : ""} from ${v.retireAge}, your money would last to about age ${low}${high > low ? ` to ${high}` : ""} (the plan runs to ${PLAN_TO_AGE}). The most that lasts to ${PLAN_TO_AGE} is ${formatCents(p.sustainableMonthly.lowCents)} to ${formatCents(p.sustainableMonthly.highCents)} a month before tax.`;
}

export const rmdLine = (v: View) =>
  v.rmd
    ? `Required minimum distributions start at ${v.rmd.startAge}${v.rmd.firstYearCents !== null ? `; on today's pre-tax balance the first year's minimum would be about ${formatCents(v.rmd.firstYearCents)}` : ""}.`
    : null;

// Each kind by its plain name. The page's labels carry "first", "then" and "last", which read
// wrong once an empty kind is left out ("1. then pre-tax accounts"), and lower-casing them made
// "IRA" "ira" (night round 11-06).
const DRAW_NAMES: Record<View["draw"][number]["key"], string> = {
  taxableCents: "taxable accounts",
  preTaxCents: "pre-tax accounts (401(k), traditional IRA)",
  rothCents: "Roth",
};

export const drawLine = (v: View) =>
  v.draw.length === 0
    ? null
    : v.draw.length === 1
      ? `Draw from your ${DRAW_NAMES[v.draw[0].key]}.`
      : `The order to draw: ${v.draw.map((d, i) => `${i + 1}. ${DRAW_NAMES[d.key]}`).join(", ")}.`;
