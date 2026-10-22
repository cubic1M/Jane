import { VALUES_EXCLUSIONS, VALUES_THEMES } from "@/config/values";
import type { ValuesView } from "@/lib/investments/values";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Investing by your values in the chat (spec step 236): shared words and buttons. The cost
// in dollars and what it does to diversification are always said.

export const VALUES_LINK: MessageAction = {
  id: "open",
  label: "See my list",
  kind: "link",
  href: "/investments/values",
};

const signed = (cents: number) => `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;

export const valuesListWords = (prefs: ValuesView["prefs"]) =>
  [
    ...prefs.excludes.map((e) => `no ${VALUES_EXCLUSIONS[e].toLowerCase()}`),
    ...prefs.themes.map((t) => `leaning towards ${VALUES_THEMES[t].toLowerCase()}`),
  ].join(", ");

export function valuesPlanLine(view: ValuesView): string {
  const plan = view.plan;
  if (!plan || plan.switches.length === 0) {
    return `Your list (${valuesListWords(view.prefs)}) already matches your funds, or nothing can be switched. ${view.note}`;
  }
  const div = plan.diversification
    .map(
      (d) =>
        `${d.assetClass.replace("_", " ")} goes from about ${d.beforeHoldings.toLocaleString("en-US")} holdings to ${d.afterHoldings.toLocaleString("en-US")}`,
    )
    .join("; ");
  const tax =
    plan.gainCents > 0
      ? ` Selling in taxable accounts realises about ${formatCents(plan.gainCents)} of gains.`
      : "";
  return `To match your list (${valuesListWords(view.prefs)}), ${plan.switches.length} of your funds would switch inside the same kind of investment, so your stocks-and-bonds mix doesn't change. Fees change by ${signed(plan.feeDeltaCents)} a year.${tax} Diversification: ${div}.`;
}

export const valuesButton = (): MessageAction => ({
  id: "values.apply",
  label: "Switch these funds",
  kind: "primary",
});
