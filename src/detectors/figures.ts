import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { dollars, factEvidence } from "./helpers";

// Every figure explained, and correctable (spec step 239), brought to the person unasked: a
// headline figure resting on something Jane can't know by herself. Pure; see ./contract.ts.

// A business's deposits are sales, not pay, so "monthly income" (and the budget, safe to
// spend and health score built on it) counts far more than the owner takes home until they
// say what they pay themselves. Once they've told Jane, it's quiet.
const businessIncome: Detector = {
  covers: ["explain_figure"],
  capability: "figures",
  topic: "figure_check",
  needs: ["income_pattern", "monthly_income"],
  detect({ profile }) {
    const pattern = profile.facts.income_pattern;
    const income = profile.facts.monthly_income;
    if (pattern.value !== "business" || income.source === "told") return null;
    if (typeof income.value !== "number" || income.value <= 0) return null;
    const deposits = income.value;
    const overstated = Math.round(deposits * (1 - R.tax.businessProfitShare));
    return {
      id: suggestionId("figures", "figure_check"),
      capability: "figures",
      topic: "figure_check",
      title: "Tell me what you pay yourself, so your income figure is right",
      headline: `Tell me your pay: ${dollars(overstated)}/mo may not be income`,
      short: `I count ${formatCents(deposits)} a month of business deposits as your income.`,
      worthCents: overstated,
      worthKind: "risk",
      confidence: factEvidence(pattern),
      urgency: "soon",
      why: `Your ${formatCents(deposits)} a month of deposits are the shop's sales, so your income, budget, safe to spend and health score all count them as pay. If about ${Math.round(R.tax.businessProfitShare * 100)}% is profit, about ${formatCents(overstated)} a month of it isn't yours to spend. Tell me what you take home and every figure will use it.`,
      action: { label: "Correct my income", href: "/figures/monthly_income" },
    };
  },
};

export const FIGURES_DETECTORS: readonly Detector[] = [businessIncome];
