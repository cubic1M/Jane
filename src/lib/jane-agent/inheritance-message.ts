import { ELIGIBLE_BENEFICIARIES } from "@/config/inheritance";
import type { InheritanceView, InheritedIra } from "@/lib/inheritance";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";

// Inherited money and gifts in the chat (spec step 268): an inherited IRA's deadline and how to
// spread it (demo advice), gifts over the annual exclusion, and the answer to "I inherited
// an IRA", "step-up in basis", "gift tax". Facts, with a pointer to counsel: no legal advice.

export const INHERITED_HREF = "/profile";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function inheritedIraMessage(v: InheritanceView, ira: InheritedIra): Message | null {
  if (!v.advice || !ira.spread?.worthRaising || (ira.emptyBy === null && ira.fromSpouse === true))
    return null;
  const s = ira.spread;
  const deadline =
    ira.emptyBy !== null
      ? `By the rule for most heirs, it has to be empty by December 31, ${ira.emptyBy}.`
      : "Most heirs have to empty it within 10 years of the owner's death; tell me the year and I'll give the date.";
  return {
    body: `You have ${roundDollars(ira.balanceCents)} in ${ira.name}. ${deadline} Taking it out evenly, about ${roundDollars(s.perYearCents)} a year, instead of all at the end would save about ${roundDollars(s.savesCents)} in tax, because it keeps each year in a lower bracket. If the original owner had already started required withdrawals, there are yearly ones too, and a few heirs (${ELIGIBLE_BENEFICIARIES.join("; ")}) follow other rules. A tax professional should confirm which applies to you.`,
    refs: { advice: true, taxYear: v.year },
    actions: [
      { id: "open", label: "Tell Jane when they died", kind: "link", href: INHERITED_HREF },
      { id: "open", label: "Share with my accountant", kind: "link", href: "/taxes/accountant" },
    ],
  };
}

export function giftsMessage(v: InheritanceView): Message | null {
  const g = v.gifts[0];
  if (!g) return null;
  return {
    body: `You sent ${g.recipient} ${formatCents(g.cents)} this year, ${formatCents(g.overCents)} over the ${formatCents(v.exclusionCents)} a person can give another without telling the IRS. ${g.splitCovers ? "As a married couple you can split it, which covers it, but that still takes a gift tax return (Form 709)." : "That takes a gift tax return (Form 709) due April 15."} No tax is usually owed: the extra counts against a lifetime allowance of ${roundDollars(1_500_000_000)} per person. A tax professional can prepare the form.`,
    refs: { taxYear: v.year },
    actions: [
      { id: "open", label: "Share with my accountant", kind: "link", href: "/taxes/accountant" },
    ],
  };
}

export function inheritanceReply(v: InheritanceView): Message {
  const lines: string[] = [];
  for (const i of v.inherited) {
    lines.push(
      i.fromSpouse === true
        ? `${i.name} (${formatCents(i.balanceCents)}) came from your spouse: you can treat it as your own, with no 10-year deadline.`
        : `${i.name} (${formatCents(i.balanceCents)}): ${i.emptyBy !== null ? `empty by December 31, ${i.emptyBy}` : "I don't know the year the owner died, so I can't give the date; most heirs have 10 years"}.${v.advice && i.spread?.worthRaising ? ` Evenly, about ${formatCents(i.spread.perYearCents)} a year, saves about ${formatCents(i.spread.savesCents)} against taking it all at the end.` : ""}`,
    );
  }
  for (const g of v.gifts) {
    lines.push(
      `Gifts: ${formatCents(g.cents)} to ${g.recipient} this year, over the ${formatCents(v.exclusionCents)} exclusion, which takes a gift tax return (Form 709).`,
    );
  }
  lines.push(
    "Inherited stocks and property get a new cost basis: their value on the day the owner died. Selling soon after has little or no gain to tax.",
  );
  lines.push(...v.estate);
  return {
    body: `Here is what I can say about inherited money and gifts.\n${lines.map((l) => `• ${l}`).join("\n")}`,
    refs: {},
    actions: [
      { id: "open", label: "Tell Jane what you inherited", kind: "link", href: INHERITED_HREF },
    ],
  };
}
