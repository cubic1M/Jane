import { cardHeadline } from "@/detectors/contract";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { STRATEGIST_CAPABILITY } from "@/config/strategist";
import type { OfferedSuggestion } from "@/lib/suggestions";
import { sentence, type MessageSource } from "./source";
import { openLink } from "../types";

// What Jane worked out for this person (spec step 255): the nightly scan's top suggestions, a
// few a day. Each says what it is worth, why this person, and how sure Jane is with the
// reason, then asks. A no is for good (answerSuggestion).

// The short card (docs/detectors.md, "Short forms"): the headline, one why-you line with the
// person's own number, and how sure Jane is. The whole explanation is behind "Why?".
export function suggestionCard(
  s: Pick<OfferedSuggestion, "headline" | "short" | "confidencePercent" | "confidenceReason">,
): string[] {
  return [
    cardHeadline(s.headline),
    `Why you: ${sentence(s.short)}`,
    `${s.confidencePercent}% sure: ${s.confidenceReason}.`,
  ];
}

// A strategist idea (spec step 256) is Claude's own words, often about taxes or investing, so it
// carries AI_WRITTEN_LABEL like a chat answer would (src/config/advice.ts), "Why?" included.
const byClaude = (key: string) => key.startsWith(`${STRATEGIST_CAPABILITY}:`);

export const suggestionsSource: MessageSource = {
  key: "suggestions",
  gather(snapshot) {
    return (snapshot.suggestions ?? []).map((s) => ({
      kind: "decision" as const,
      body: suggestionCard(s).join("\n"),
      refs: {
        suggestion: s.key,
        suggestionWhy: s.why,
        ...(s.people ? { suggestionPeople: s.people } : {}),
        ...(s.advice ? { advice: true as const } : {}),
        ...(byClaude(s.key) ? { aiWritten: true as const } : {}),
        ...(s.cardDetails ? { cardDetails: s.cardDetails } : {}),
      },
      actions: [
        { id: "suggestion.yes" as const, label: s.actionLabel, kind: "primary" as const },
        { id: "snooze" as const, label: "Not now", kind: "secondary" as const },
        { id: "suggestion.no" as const, label: "Not for me", kind: "secondary" as const },
        { id: "suggestion.why" as const, label: "Why?", kind: "quick" as const },
        openLink("Open", s.actionHref),
        ...s.more.map((m) => openLink(m.label, m.href)),
      ],
      // The day it was chosen, not today: an unanswered pick stays offered, and isn't posted twice.
      dedupeKey: `${s.key}:${s.chosenOn}`,
      priority: MESSAGE_PRIORITY.suggestions,
    }));
  },
};
