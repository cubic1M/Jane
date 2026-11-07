import { SPENDING_DETECTOR_RATES as S } from "@/config/detectors-spending";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, headlineOf, nice, tx } from "./helpers";

// Utilities (connectors roadmap round 17). Read only, no vendor, no Claude call. Pure; see
// ./contract.ts.

const ENERGY = "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY";

// A gas or electric bill that swings with the seasons (budget_billing_hint): many utilities offer
// budget (level) billing, the same amount each month from the yearly average, trued up once a year.
// It costs nothing and saves nothing: it evens out the big months. Worth what the biggest month
// runs over the average.
const budgetBilling: Detector = {
  capability: "cost",
  topic: "budget_billing",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const byPayee = new Map<string, Map<string, number>>();
    for (const t of tx(data, (x) => x.pfc === ENERGY && x.amountCents > 0)) {
      const months = byPayee.get(t.description) ?? new Map<string, number>();
      const month = t.date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + t.amountCents);
      byPayee.set(t.description, months);
    }
    const swings = [...byPayee.entries()]
      .map(([payee, months]) => {
        const totals = [...months.values()];
        const max = Math.max(...totals);
        const min = Math.min(...totals);
        const average = Math.round(totals.reduce((s, n) => s + n, 0) / totals.length);
        return { payee, months: totals.length, max, min, average, jump: max - average };
      })
      .filter(
        (p) =>
          p.months >= S.budgetBillingMonthsMin &&
          p.min > 0 &&
          p.max >= p.min * S.budgetBillingSwingRatio &&
          p.jump >= S.budgetBillingMinJumpCents,
      )
      .sort((a, b) => b.jump - a.jump);
    const top = swings[0];
    if (!top) return null;
    const name = nice(top.payee);
    return {
      id: suggestionId("cost", "budget_billing"),
      capability: "cost",
      topic: "budget_billing",
      title: `Even out your ${name} bill with budget billing`,
      headline: headlineOf(`Even out your ${name} bill`, top.jump, "risk"),
      short: `Your ${name} bill ran from ${formatCents(top.min)} to ${formatCents(top.max)} a month.`,
      worthCents: top.jump,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, top.months, `months of ${name} bills`),
      urgency: "later",
      why: `Your ${name} bill ran from ${formatCents(top.min)} to ${formatCents(top.max)} a month over ${top.months} months, about ${formatCents(top.average)} on average. Many utilities offer budget (level) billing: about the same amount each month from your yearly average, settled up once a year. It doesn't lower the total; it takes the ${formatCents(top.jump)} jump out of the biggest month. Ask ${name}, or look for it in your account online.`,
      action: { label: "See your bills", href: "/bills" },
    };
  },
};

export const UTILITY_DETECTORS: readonly Detector[] = [budgetBilling];
