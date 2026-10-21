import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { sentence, type MessageSource } from "./source";

// What Jane worked out for this person (spec step 255): the nightly scan's top suggestions, a
// few a day. Each says what it is worth, why this person, and how sure Jane is with the
// reason, then asks. A no is for good (answerSuggestion).

export const WORTH = {
  saves: (cents: number) => `could save you about ${formatCents(cents)} a year`,
  earns: (cents: number) => `could earn you about ${formatCents(cents)} a year`,
  risk: (cents: number) => `could protect you from a loss of about ${formatCents(cents)}`,
} as const;

export const suggestionsSource: MessageSource = {
  key: "suggestions",
  gather(snapshot) {
    return (snapshot.suggestions ?? []).map((s) => ({
      kind: "decision" as const,
      body: [
        sentence(s.title),
        `This ${WORTH[s.worthKind as keyof typeof WORTH]?.(s.worthCents) ?? "is worth a look"}.`,
        sentence(s.why),
        `I'm ${s.confidencePercent}% sure, based on ${s.confidenceReason}.`,
        "Want to do it?",
      ].join(" "),
      refs: { suggestion: s.key, ...(s.advice ? { advice: true as const } : {}) },
      actions: [
        { id: "suggestion.yes" as const, label: s.actionLabel, kind: "primary" as const },
        { id: "suggestion.no" as const, label: "Not for me", kind: "secondary" as const },
        { id: "open" as const, label: "Open", kind: "link" as const, href: s.actionHref },
        ...s.more.map((m) => ({
          id: "open" as const,
          label: m.label,
          kind: "link" as const,
          href: m.href,
        })),
      ],
      dedupeKey: `${s.key}:${snapshot.asOf}`,
      priority: MESSAGE_PRIORITY.suggestions,
    }));
  },
};
