import { FILING_STATUSES, type FilingStatus } from "@/config/tax";
import type { FamilyView } from "@/lib/family-taxes";
import type { FamilyChoice } from "@/planning/family-taxes";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { FILING_BUTTONS } from "./tax-flow";
import type { MessageAction, MessageRefs } from "./types";

// Family taxes in the chat (spec step 169, demo advice): a choice with both sides' tax, and
// the answer to "should we file jointly or separately", "FSA or the credit" and the like.

export const FAMILY_HREF = "/taxes#family";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const sideLine = (c: FamilyChoice, i: 0 | 1) => {
  const s = c.sides[i];
  return s.eligible
    ? `• ${s.label}: tax about ${roundDollars(s.taxCents)}${c.better === i ? " (less)" : ""}`
    : `• ${s.label}: not open to you (${s.why.join(" ")})`;
};

export function choiceLines(c: FamilyChoice): string {
  return `${c.title}:\n${sideLine(c, 0)}\n${sideLine(c, 1)}`;
}

// The filing status a filing choice's side stands for.
export function statusOf(label: string): FilingStatus {
  if (label.startsWith("Married filing jointly")) return "married_joint";
  if (label.startsWith("Married filing separately")) return "married_separate";
  if (label === "Head of household") return "head_of_household";
  return "single";
}

export function familyChoiceMessage(c: FamilyChoice, year: number): Message {
  const better = c.sides[c.better!];
  // Filing status can be set from here; the rest are chosen elsewhere (open enrollment,
  // the return).
  const status = c.key === "filing" ? statusOf(better.label) : null;
  return {
    body: `${choiceLines(c)}\n${better.label.replace(/ \(both returns\)$/, "")} saves about ${roundDollars(c.savesCents)} for ${year}. Federal tax, estimated.`,
    refs: { advice: true, taxYear: year, ...(status ? { taxField: "filingStatus" } : {}) },
    actions: [
      ...(status
        ? [
            {
              id: FILING_BUTTONS[status],
              label: `File as ${FILING_STATUSES[status].toLowerCase()}`,
              kind: "primary",
            } as MessageAction,
          ]
        : []),
      { id: "open", label: "See family taxes", kind: "link", href: FAMILY_HREF },
    ],
  };
}

export function familyReply(view: FamilyView): Message {
  if (!view.advice) {
    return {
      body: "Comparing family tax choices will come once Jane works with a tax professional. Your estimate counts your children already.",
      refs: {},
      actions: [{ id: "open", label: "See your taxes", kind: "link", href: "/taxes" }],
    };
  }
  if (view.choices.length === 0) {
    return {
      body: `I don't see a family tax choice for ${view.year}: no children, childcare, tuition, 529 or spouse on your tax profile. Add family details and I'll compare.`,
      refs: { advice: true },
      actions: [
        { id: "open", label: "Add family details", kind: "link", href: "/taxes/profile#family" },
      ],
    };
  }
  const notes = view.assumptions.length > 0 ? `\n${view.assumptions.join(" ")}` : "";
  return {
    body: `Your family tax choices for ${view.year}, each side's federal tax (estimated):\n${view.choices.map(choiceLines).join("\n")}${notes}`,
    refs: { advice: true },
    actions: [{ id: "open", label: "See family taxes", kind: "link", href: FAMILY_HREF }],
  };
}
