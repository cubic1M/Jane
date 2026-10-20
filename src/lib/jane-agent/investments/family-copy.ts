import { CUSTODIAL_NOTE } from "@/config/family";
import type { FamilyView } from "@/lib/investments/family";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Investing for the family in the chat (spec step 213): shared words and buttons. The
// gift link itself appears only in the reply to the person who made it, never in a message
// for anyone else.

export const FAMILY_LINK: MessageAction = {
  id: "open",
  label: "See family investing",
  kind: "link",
  href: "/investments/family",
};

type Child = FamilyView["children"][number];

export const giftOffer = (c: Child) =>
  `${c.college?.goalName ?? `${c.name}'s college fund`} is ${c.college?.percent ?? 0}% of ${formatCents(c.college?.targetCents ?? 0)}. Want a link grandparents and other relatives can use to give to it? It shows only the goal and how far along it is, never your money.`;

export const rothOffer = (c: Child) =>
  `${c.name} earned ${formatCents(c.earnedCents)} this year, so up to ${formatCents(c.roth?.roomCents ?? 0)} can go in a Roth IRA for ${c.name}. Starting young is worth years of tax-free growth.`;

export function familyLine(v: FamilyView): string {
  if (v.children.length === 0)
    return "Tell me about your children (name, age and what they earned) on the family page and I'll look at a custodial account, a Roth IRA for a child who earns, and a gift link for their college fund.";
  return v.children
    .map((c) => {
      const bits = [
        c.custodial ? `custodial account ${formatCents(c.custodial.balanceCents)}` : null,
        c.roth
          ? `Roth IRA with ${formatCents(c.roth.roomCents)} of room this year`
          : c.earnedCents > 0
            ? `earned ${formatCents(c.earnedCents)}, so a Roth IRA is possible`
            : "no earned income, so no Roth IRA yet",
        c.college
          ? `college fund ${c.college.percent}% funded${c.gift ? ", gift link active" : ""}`
          : null,
      ].filter(Boolean);
      return `${c.name}: ${bits.join("; ")}`;
    })
    .join(". ")
    .concat(`. ${CUSTODIAL_NOTE}`);
}
