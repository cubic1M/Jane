import { cardHeadline } from "@/detectors/contract";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { OfferedSuggestion } from "@/lib/suggestions";
import { sentence, type MessageSource } from "./source";

// What Jane worked out for this person (spec step 255): the nightly scan's top suggestions, a
// few a day. Each says what it is worth, why this person, and how sure Jane is with the
// reason, then asks. A no is for good (answerSuggestion).

// The short card (docs/detectors.md, "Short forms"): the headline, one why-you line with the
// person's own number, and how sure Jane is. The whole explanation is behind "Why?".
export function suggestionCard(s: OfferedSuggestion): string[] {
  return [
    cardHeadline(s.headline),
    `Why you: ${sentence(s.short)}`,
    `${s.confidencePercent}% sure: ${s.confidenceReason}.`,
  ];
}

export const suggestionsSource: MessageSource = {
  key: "suggestions",
  gather(snapshot) {
    return (snapshot.suggestions ?? []).map((s) => ({
      kind: "decision" as const,
      body: suggestionCard(s).join("\n"),
      refs: {
        suggestion: s.key,
        ...(s.advice ? { advice: true as const } : {}),
        ...(s.cardDetails ? { cardDetails: s.cardDetails } : {}),
      },
      actions: [
        { id: "suggestion.yes" as const, label: s.actionLabel, kind: "primary" as const },
        { id: "snooze" as const, label: "Not now", kind: "secondary" as const },
        { id: "suggestion.no" as const, label: "Not for me", kind: "secondary" as const },
        { id: "suggestion.why" as const, label: "Why?", kind: "quick" as const },
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
