import { PEOPLE, type Person, type SuggestionTopic } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS, runDetectors } from "./index";
import type { Detector, Suggestion } from "./contract";

// The detector harness (spec step 254): runs every detector on the eight sample people and
// compares what fired with each person's written list. Pure and database-free, so it runs
// in unit tests and in the nightly CI (step 258).

export type PersonReport = {
  person: Person;
  fired: Suggestion[];
  // On the person's should-list and fired.
  hit: SuggestionTopic[];
  // On the should-list and not fired: `covered` says whether any detector exists for it yet
  // (an uncovered topic is waiting for its lane in Phase AS; a covered one is a real miss).
  missed: { topic: SuggestionTopic; covered: boolean }[];
  // On the must-not list and fired: a wrong suggestion.
  wrong: Suggestion[];
  // Fired, and on neither list.
  extra: SuggestionTopic[];
};

const covered = (topic: SuggestionTopic, detectors: readonly Detector[]) =>
  detectors.some((d) => d.topic === topic);

export function reportFor(
  person: Person,
  detectors: readonly Detector[] = DETECTORS,
): PersonReport {
  const data = inputFor(person.id);
  const profile = buildProfile(data);
  const fired = runDetectors({ profile, data }, detectors, (d, error) => {
    throw new Error(
      `Detector ${d.capability}:${d.topic} failed for ${person.id}: ${String(error)}`,
    );
  });
  const topics = new Set(fired.map((s) => s.topic));
  return {
    person,
    fired,
    hit: person.should.filter((t) => topics.has(t)),
    missed: person.should
      .filter((t) => !topics.has(t))
      .map((topic) => ({ topic, covered: covered(topic, detectors) })),
    wrong: fired.filter((s) => person.mustNot.includes(s.topic)),
    extra: [...topics].filter((t) => !person.should.includes(t) && !person.mustNot.includes(t)),
  };
}

export const runHarness = (detectors: readonly Detector[] = DETECTORS): PersonReport[] =>
  PEOPLE.map((p) => reportFor(p, detectors));

// Per person, what fired and what should have, as plain text for a log or a PR comment.
export function formatReport(reports: readonly PersonReport[]): string {
  return reports
    .map((r) =>
      [
        `${r.person.id} (${r.person.label})`,
        `  fired:   ${r.fired.map((s) => `${s.topic} ${s.confidence.percent}%`).join(", ") || "nothing"}`,
        `  should:  ${r.person.should.join(", ")}`,
        `  hit:     ${r.hit.join(", ") || "none"}`,
        `  missed:  ${r.missed.map((m) => (m.covered ? `${m.topic} (MISS)` : `${m.topic} (no detector yet)`)).join(", ") || "none"}`,
        `  wrong:   ${r.wrong.map((s) => s.topic).join(", ") || "none"}`,
      ].join("\n"),
    )
    .join("\n\n");
}
