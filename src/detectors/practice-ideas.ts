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
    `The numbers: ${idea.figures.map((f) => `${f.label} ${f.value}`).join("; ")}.`,
    `The caps: ${idea.caps.join("; ")}.`,
    "Practice money only: nothing real is bought or sold.",
  ].join(" ");
}

function practiceDetector(kind: Kind): Detector {
  const topic = PRACTICE_TOPIC[kind];
  return {
    capability: "investing",
    topic,
    needs: [],
    covers: [],
    detect({ data }): Suggestion | null {
      const idea = (data.extras?.practiceIdeas ?? []).find((i) => i.kind === kind);
      if (!idea) return null;
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
    },
  };
}

export const PRACTICE_IDEA_DETECTORS: readonly Detector[] = (
  Object.keys(PRACTICE_TOPIC) as Kind[]
).map(practiceDetector);
