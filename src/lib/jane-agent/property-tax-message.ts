import type { PropertyTaxView } from "@/lib/property-tax";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";
import { formatPercent as pct } from "@/lib/percent";

// Property tax in the chat (spec step 221): an assessment worth appealing (demo advice), the
// drafted appeal and who files it, an exemption not yet claimed, and the answer to "is my
// property tax too high".

export const PROPERTY_HREF = "/taxes/property";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function appealSuggestedMessage(v: PropertyTaxView): Message {
  const g = v.gap!;
  return {
    body: `Your home is assessed at ${roundDollars(g.assessedCents)}, about ${pct(g.gapRate)} above the ${roundDollars(g.marketCents)} that recent sales of comparable homes point to. That could cost you about ${roundDollars(g.savingCents)} a year in extra property tax. ${v.window.text} Want me to draft the appeal? Nothing is filed until you say who files it.`,
    refs: { advice: true, taxYear: v.year },
    actions: [
      { id: "tax.property_draft", label: "Draft the appeal", kind: "primary" },
      { id: "tax.property_remind", label: "Just remind me of the deadline", kind: "secondary" },
      { id: "open", label: "See the details", kind: "link", href: PROPERTY_HREF },
    ],
  };
}

export function appealDraftedMessage(v: PropertyTaxView): Message {
  const a = v.appeal!;
  return {
    body: `Your ${a.year} property tax appeal to ${a.board} is drafted, with ${v.comps.length} comparable sales. It could save about ${roundDollars(a.savingCents)} a year. Who should file it? I file nothing myself.`,
    refs: { advice: true, taxYear: a.year },
    actions: [
      { id: "tax.property_team", label: "My team files it", kind: "primary" },
      { id: "tax.property_self", label: "I'll file it", kind: "secondary" },
      { id: "tax.property_drop", label: "Never mind", kind: "secondary" },
      { id: "open", label: "Read the draft", kind: "link", href: PROPERTY_HREF },
    ],
  };
}

export function exemptionMessage(v: PropertyTaxView): Message | null {
  const e = v.exemptions.eligible[0];
  if (!e || !v.advice) return null;
  return {
    body: `You may qualify for the ${e.name} on your home. ${e.who} ${e.benefit} I can't see whether you already have it. Have you claimed it?`,
    refs: { advice: true, propertyExemption: e.key },
    actions: [
      { id: "tax.exemption_remind", label: "Remind me to apply", kind: "primary" },
      { id: "tax.exemption_claimed", label: "I already have it", kind: "secondary" },
      { id: "open", label: "See the details", kind: "link", href: PROPERTY_HREF },
    ],
  };
}

export function propertyReply(v: PropertyTaxView): Message {
  if (!v.homeowner) {
    return {
      body: "I don't see a home in your accounts. If you own one, tell me what it's worth and what the county assessed it at, and I'll check whether your property tax is too high.",
      refs: {},
      actions: [
        { id: "open", label: "Tell Jane about your home", kind: "link", href: PROPERTY_HREF },
      ],
    };
  }
  const lines: string[] = [];
  const g = v.gap;
  if (g) {
    lines.push(
      `Assessed at ${formatCents(g.assessedCents)} against a market value of ${formatCents(g.marketCents)}${v.figuresFrom === "you" ? " (your figures)" : " (sample data)"}: ${g.gapCents > 0 ? `${pct(g.gapRate)} over` : "not over"}.`,
    );
    if (v.advice) {
      lines.push(
        v.suggested
          ? `That's worth appealing: about ${formatCents(g.savingCents)} a year. ${v.window.text}`
          : g.worthAppealing
            ? `The gap is big enough, but ${v.window.status === "closed" ? "the window has closed" : "I don't have comparable sales to back an appeal"}.`
            : "The gap is too small to be worth an appeal.",
      );
    }
  } else {
    lines.push(
      "I don't have your home's assessed and market values yet. Tell me both and I'll compare them.",
    );
  }
  if (v.appeal && v.appeal.status !== "dropped") {
    lines.push(
      `Your appeal is ${v.appeal.status === "drafted" ? "drafted" : v.appeal.status === "team" ? "with my team to file" : "yours to file"}.`,
    );
  }
  if (v.advice) {
    for (const e of v.exemptions.eligible)
      lines.push(`You may qualify for the ${e.name}: ${e.benefit}`);
    if (v.exemptions.ask.length > 0) {
      lines.push(`Tell me ${v.exemptions.ask.join(" and ")} and I'll check for more exemptions.`);
    }
  }
  const top = v.advice && v.suggested && !v.appeal;
  return {
    body: `Here is how your property tax looks.\n${lines.map((l) => `• ${l}`).join("\n")}`,
    refs: v.advice ? { advice: true } : {},
    actions: [
      ...(top
        ? [
            {
              id: "tax.property_draft" as const,
              label: "Draft the appeal",
              kind: "primary" as const,
            },
          ]
        : []),
      { id: "open", label: "See my property tax", kind: "link", href: PROPERTY_HREF },
    ],
  };
}
