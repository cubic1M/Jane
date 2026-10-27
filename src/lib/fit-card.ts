import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { FIT_NEEDS, FIT_NEED_LABELS, type FitNeed } from "@/config/fit";
import type { FitNeedInput, FitView } from "@/lib/fit";
import { formatCents } from "@/lib/money";
import {
  MAX_CARD_OPTIONS,
  OPTION_HEADLINE_WORDS,
  cardProblems,
  type CardOption,
  type OptionCard,
  type OptionCompare,
} from "@/lib/option-card";
import type { FitLabel, FitOption } from "@/planning/fit";
import { formatRate } from "@/lib/percent";

// The fit engine's options as the shared pick-one card (spec step 282, src/lib/option-card.ts),
// kind "loan": a short headline with one dollar figure, the monthly payment, the facts (rate,
// term, total interest, fees), why this one, and "More details" with the maths. Jane's pick and
// how sure Jane is are set only in demo advice mode. Pure; the chat turns it into the floating
// card, and a pick goes through ./fit-pick.ts.

// The topic carries what the options were priced for, so a pick can be priced again on the
// server: "car:2000000", "consolidation", "refinance:<debt key>".
export function fitTopic(want: FitNeedInput): string {
  if (want.need === "refinance") return want.debtKey ? `refinance:${want.debtKey}` : "refinance";
  if (want.need === "consolidation") return "consolidation";
  return `${want.need}:${want.amountCents ?? 0}`;
}

export function parseFitTopic(topic: string): FitNeedInput | null {
  const at = topic.indexOf(":");
  const need = at < 0 ? topic : topic.slice(0, at);
  const rest = at < 0 ? undefined : topic.slice(at + 1);
  if (!(FIT_NEEDS as readonly string[]).includes(need)) return null;
  const n = need as FitNeed;
  if (n === "consolidation") return rest === undefined ? { need: n } : null;
  if (n === "refinance") return rest ? { need: n, debtKey: rest } : { need: n };
  const amountCents = Number(rest);
  return Number.isSafeInteger(amountCents) && amountCents > 0 ? { need: n, amountCents } : null;
}

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
const rate = (bps: number) => formatRate(bps).replace(/\.?0+%$/, "%");
const words = (s: string) => s.trim().split(/\s+/).length;

// One short line with one dollar figure: "Lakeside Credit Union 6.9%, save $1,840".
function headlineOf(o: FitOption): string {
  if (o.label === "payoff") return `Pay it off with cash, save ${dollars(o.savesCents ?? 0)}`;
  if (o.label === "keep") return `Keep what you have, ${dollars(o.paymentCents)} a month`;
  const tail =
    o.savesCents === null
      ? `${dollars(o.paymentCents)} a month`
      : o.savesCents >= 0
        ? `save ${dollars(o.savesCents)}`
        : `${dollars(-o.savesCents)} more in all`;
  const full = `${o.lender} ${rate(o.aprBps)}, ${tail}`;
  // A long lender name keeps only its first word, so the line stays short.
  return words(full) <= OPTION_HEADLINE_WORDS
    ? full
    : `${o.lender.split(/\s+/)[0]} ${rate(o.aprBps)}, ${tail}`;
}

// Interest over the term: everything paid less what was borrowed and the fees.
const interestOf = (o: FitOption, view: FitView) => {
  if (o.label === "payoff") return 0;
  const principal = o.label === "keep" ? (view.baseline?.balanceCents ?? 0) : view.amountCents;
  return Math.max(0, o.totalCostCents - o.feeCents - principal);
};

function factsOf(o: FitOption, view: FitView): string[] {
  if (o.label === "payoff") {
    return [
      "APR: none, paid from your cash",
      "Term: paid off now",
      "Total interest: $0.00",
      "Fees: none",
    ];
  }
  return [
    `APR: ${formatRate(o.aprBps)}${o.rateType ? ` ${o.rateType}` : ""}`,
    `Term: ${o.termMonths} months`,
    `Total interest: ${formatCents(interestOf(o, view))}`,
    `Fees: ${o.feeCents > 0 ? formatCents(o.feeCents) : "none"}`,
  ];
}

function whyOf(o: FitOption, view: FitView): string {
  const saves =
    o.savesCents !== null && o.savesCents > 0 && view.baseline && o.label !== "keep"
      ? ` ${formatCents(o.savesCents)} less in all than keeping ${view.baseline.label}.`
      : "";
  switch (o.label) {
    case "payoff":
      return `No new loan and no more interest, and you still keep a month of spending.${saves}`;
    case "keep":
      return view.pick === "keep"
        ? "No offer saves enough to be worth moving, so nothing to apply for."
        : "No new loan: you keep paying what you pay now.";
    case "best_cost":
      return `The least paid in all, fees counted, at a payment that fits your income.${saves}`;
    case "lowest_payment":
      return o.comfortable
        ? `The smallest monthly payment.${saves}`
        : `The smallest monthly payment, though none of these fits comfortably.${saves}`;
    case "fastest":
      return `Paid off soonest, so the least time in debt.${saves}`;
    case "alternative":
      return `Another lender, close on cost.${saves}`;
  }
}

// Who each option suits, for the comparison cards (src/lib/comparison.ts).
const BEST_FOR: Record<FitLabel, string> = {
  payoff: "Best for paying no more interest",
  keep: "Best for changing nothing",
  best_cost: "Best for the least paid in all",
  lowest_payment: "Best for the smallest monthly bill",
  fastest: "Best for being debt-free soonest",
  alternative: "Best for a second lender to try",
};

// The numbers the comparison cards line up: the payment, everything paid, how soon it's gone.
function compareOf(o: FitOption): OptionCompare {
  const payoff = o.label === "payoff";
  return {
    monthlyCents: o.paymentCents,
    totalCents: o.totalCostCents,
    coverScore: null,
    payoffMonths: o.termMonths,
    rows: [
      {
        key: "apr",
        label: "APR",
        value: payoff ? "none" : `${formatRate(o.aprBps)}${o.rateType ? ` ${o.rateType}` : ""}`,
      },
      {
        key: "term",
        label: "Term",
        value: payoff ? "paid off now" : `${o.termMonths} months`,
      },
      { key: "total", label: "Total cost", value: dollars(o.totalCostCents) },
      { key: "fees", label: "Fees", value: o.feeCents > 0 ? dollars(o.feeCents) : "none" },
    ],
    bestFor: BEST_FOR[o.label],
  };
}

// The pick first, then the others in the engine's order, at most MAX_CARD_OPTIONS.
function ordered(view: FitView): FitOption[] {
  const pick = view.options.find((o) => o.id === view.pick);
  const rest = view.options.filter((o) => o !== pick);
  return (pick ? [pick, ...rest] : rest).slice(0, MAX_CARD_OPTIONS);
}

// Null when there is nothing to choose from (no partner, nothing fits).
export function fitCard(view: FitView, advice: boolean): OptionCard | null {
  if (view.options.length === 0) return null;
  const options: CardOption[] = ordered(view).map((o) => {
    const isPick = advice && o.id === view.pick;
    return {
      id: o.id,
      label: o.lender,
      headline: headlineOf(o),
      priceCents: o.paymentCents,
      pricePeriod: "month",
      facts: factsOf(o, view),
      whyThisOne: whyOf(o, view),
      isPick,
      ...(isPick && view.confidence ? { confidence: view.confidence } : {}),
      details: isPick ? [...o.details, DEMO_ADVICE_LABEL] : o.details,
      compare: compareOf(o),
    };
  });
  return {
    kind: "loan",
    title: `Your options for ${FIT_NEED_LABELS[view.need]}`,
    topic: fitTopic({
      need: view.need,
      ...(view.need === "car" || view.need === "home" || view.need === "personal"
        ? { amountCents: view.amountCents }
        : {}),
      ...(view.debtKey ? { debtKey: view.debtKey } : {}),
    }),
    // A new loan adds something (true); a refinance or consolidation replaces what they have.
    newCover: view.need !== "refinance" && view.need !== "consolidation",
    options,
    advice,
  };
}

// The shared card's rules, plus the loan card's own: one dollar figure in each headline, a
// monthly price, the four facts. Paying off with cash has no monthly payment, so its price is
// $0 a month, the one price of zero allowed.
export function fitCardProblems(card: OptionCard): string[] {
  const problems = cardProblems(card).filter(
    (p) =>
      !(p === "payoff: price" && card.options.find((o) => o.id === "payoff")?.priceCents === 0),
  );
  for (const o of card.options) {
    if ((o.headline.match(/\$[\d,]+/g) ?? []).length !== 1)
      problems.push(`${o.id}: not one dollar figure`);
    if (o.pricePeriod !== "month") problems.push(`${o.id}: not monthly`);
    if (o.facts.length !== 4) problems.push(`${o.id}: facts`);
  }
  if (card.kind !== "loan") problems.push("not a loan card");
  return problems;
}
