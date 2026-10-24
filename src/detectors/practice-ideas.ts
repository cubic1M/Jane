import {
  practiceIdeaId,
  PRACTICE_HREF,
  PRACTICE_RANK_FLOOR_CENTS,
  PRACTICE_SETTINGS_HREF,
  PRACTICE_TOPIC,
  PRACTICE_URGENCY,
} from "@/config/practice-suggestions";
import { rankValue } from "@/config/suggestions";
import type { PracticeIdea } from "@/profile/build";
import type { Detector, Suggestion } from "./contract";

// The practice portfolio's ideas, unasked (Phase AW, Stage A). The daily scan and the scan on
// opening a page (src/lib/practice/scan.ts) keep each idea the person should be asked about;
// one detector per kind brings the newest of that kind into the nightly suggestion scan,
// ranked with everything else. Each kind has its own topic, so what the person says to one
// kind moves that kind (src/planning/suggestion-rank.ts), and each idea is its own suggestion,
// so a no puts away that idea, not the kind. Yes acts in the PRACTICE ledger only, or opens the
// settings (src/lib/practice/ideas.ts). Demo advice only: every topic is in ADVICE_TOPICS.

type Kind = keyof typeof PRACTICE_TOPIC;

// The rule, the numbers and the caps, for "Why?".
export function practiceWhy(idea: PracticeIdea): string {
  const end = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
  return [
    end(idea.short),
    `The rule: ${idea.label.toLowerCase()}.`,
    // A source's review note is for the team, not the person.
    `The numbers: ${idea.figures.map((f) => `${f.label} ${f.value.replace(/;?\s*FOR REVIEW\.?/g, "")}`).join("; ")}.`,
    `The caps: ${idea.caps.join("; ")}.`,
    "Practice money only: nothing real is bought or sold.",
  ].join(" ");
}

// One idea as its suggestion: the detectors' output, and what the practice page records when
// the person answers an idea there before the nightly scan has.
export function practiceSuggestion(idea: PracticeIdea): Suggestion | null {
  if (!Object.hasOwn(PRACTICE_TOPIC, idea.kind)) return null;
  const kind = idea.kind as Kind;
  const topic = PRACTICE_TOPIC[kind];
  return {
    id: practiceIdeaId(topic, idea.key),
    capability: "investing",
    topic,
    title: `${idea.headline.replace(/[.!?]+$/, "")}.`,
    headline: idea.headline,
    short: idea.short,
    worthCents: idea.worthCents,
    worthKind: idea.worthKind,
    confidence: idea.confidence,
    urgency: PRACTICE_URGENCY[kind],
    why: practiceWhy(idea),
    action:
      idea.trades > 0
        ? { label: "Do it in practice", href: PRACTICE_HREF }
        : kind === "drift_warning"
          ? { label: "See your mix", href: PRACTICE_HREF }
          : { label: "Open practice settings", href: PRACTICE_SETTINGS_HREF },
    // Sample money ranks at least its kind's floor (src/config/practice-suggestions.ts).
    rankCents: Math.max(
      rankValue(topic, idea.worthKind, idea.worthCents),
      PRACTICE_RANK_FLOOR_CENTS[kind],
    ),
  };
}

function practiceDetector(kind: Kind): Detector {
  return {
    capability: "investing",
    topic: PRACTICE_TOPIC[kind],
    needs: [],
    // The theme ideas are what the chat's news_themes tool tells about.
    covers: kind === "theme_idea" ? ["news_themes"] : [],
    detect({ data }): Suggestion | null {
      const idea = (data.extras?.practiceIdeas ?? []).find((i) => i.kind === kind);
      return idea ? practiceSuggestion(idea) : null;
    },
  };
}

export const PRACTICE_IDEA_DETECTORS: readonly Detector[] = (
  Object.keys(PRACTICE_TOPIC) as Kind[]
).map(practiceDetector);
