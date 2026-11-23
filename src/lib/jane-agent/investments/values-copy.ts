import { VALUES_EXCLUSIONS, VALUES_THEMES } from "@/config/values";
import type { ValuesView } from "@/lib/investments/values";
import { formatCents } from "@/lib/money";
import { snoozeButton } from "../sources/source";
import { type Candidate, type MessageAction, openLink } from "../types";

// Investing by your values in the chat (spec step 236): shared words and buttons. The cost
// in dollars and what it does to diversification are always said.

export const VALUES_LINK: MessageAction = openLink("See my list", "/investments/values");

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

type Plan = NonNullable<ValuesView["plan"]>;

// Jane's card to switch the funds the person's list rules out (spec step 236), with the plan's
// figures as they are: posted under valuesAskKey, said again by stillTrue as prices move (debug 3,
// 11-23: keyed by each switch's amount, the equity person had one a day).
export const valuesCard = (
  view: Pick<ValuesView, "prefs" | "plan" | "note">,
): Pick<Candidate, "kind" | "body" | "refs" | "actions"> | null =>
  view.plan && view.plan.switches.length > 0
    ? {
        kind: "decision",
        body: valuesPlanLine({ ...view, advice: true, source: "" }),
        refs: { advice: true, valuesKey: view.plan.key },
        actions: [valuesButton(), VALUES_LINK, snoozeButton()],
      }
    : null;

// What the card asks, not its figures: which fund, in which account, switches to which. Asked
// again only when a switch comes or goes or goes to other funds.
export const valuesAskKey = (plan: Plan) =>
  plan.switches
    .map((s) => `${s.accountId}:${s.from.ticker}>${s.legs.map((l) => l.ticker).join("+")}`)
    .join(",");
