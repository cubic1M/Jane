import type { RiskKind } from "@/config/insurance";
import type { GapQuote, Risk } from "@/lib/insurance/risks";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";
import { dayLabel } from "@/lib/day-label";

// Risks seen in how the person lives, as one question each in Jane's chat (spec step 197),
// and the prices shown for the gap a yes opens. Pure.

const SEEN = (r: Risk, verb: string) =>
  `I saw ${formatCents(r.amountCents)} ${verb} ${r.merchant} on ${dayLabel(r.seenOn)}.`;

// Pure: the question, with what Jane saw and why it matters to the cover.
export function riskQuestion(r: Risk): string {
  switch (r.kind) {
    case "rideshare":
      return `Are you driving for ${r.merchant.replace(/ driver$/i, "")}? ${SEEN(r, "come in from")} A personal car policy may not cover you while you drive for pay.`;
    case "home_business":
      return `Do you run a business from home? ${SEEN(r, "came in from")} A home policy pays little for a business.`;
    case "new_dog":
      return `Did you get a dog, or another pet? ${SEEN(r, "went to")} If so, I'll add it to your household.`;
    case "valuable":
      return `Did you buy something valuable, like a ring or a camera? ${SEEN(r, "went to")} Policies often cap what they pay for jewelry and cameras unless the item is listed by name.`;
    case "boat":
      return `Do you have a boat? ${SEEN(r, "went to")} Home and renters policies usually cap or exclude boats.`;
    case "rental_out":
      return `Do you rent your home out? ${SEEN(r, "came in from")} A regular home policy often excludes paying guests.`;
  }
}

export const riskActions = (): MessageAction[] => [
  { id: "risk.yes", label: "Yes", kind: "primary" },
  { id: "risk.no", label: "No", kind: "secondary" },
];

// Pure: what Jane says after the answer.
export function riskAnswerNote(kind: RiskKind, yes: boolean): string {
  if (!yes) return "Okay, I won't ask about that again.";
  return kind === "new_dog"
    ? "Congratulations! I've added a pet to your household, and I'll point out pet insurance."
    : "Thanks. I've added a gap to your insurance for it, and I'll show you what cover for it costs.";
}

// Pure: sample prices for the gap, shown, never bought here.
export function gapQuotesLines(quotes: GapQuote[]): string {
  if (quotes.length === 0) return "I can't get prices for it right now.";
  return [
    "Sample prices from my demo carriers:",
    ...quotes.map(
      (q) =>
        `- ${q.carrier}: about ${formatCents(q.monthlyCents)} a month (${formatCents(q.annualCents)} a year)`,
    ),
    "These are for typical cover. Add your policy if you already have one.",
  ].join("\n");
}
