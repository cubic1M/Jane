import { SCAN_LABELS, type ScanKind } from "@/config/practice-scan";
import { PRACTICE_TOPIC } from "@/config/practice-suggestions";
import { HISTORY_FLOOR_BY_TOPIC } from "@/config/suggestions";
import { historyFactor, type TopicHistory } from "./suggestion-rank";

// What the person's answers to practice ideas changed (Phase AW, Stage A), for the practice page
// and the chat: per kind they've answered, how many yeses and noes, the rank factor the nightly
// suggestion scan gives that kind (src/planning/suggestion-rank.ts) and what that means in a
// sentence. Pure. Practice money only.

type Kind = keyof typeof PRACTICE_TOPIC;
export type LearnedEffect = "sooner" | "later" | "safety" | "same";
export type Learned = {
  kind: Kind;
  label: string;
  yes: number;
  no: number;
  // The rank factor: 1 is as before, above brings it sooner, below later.
  factor: number;
  effect: LearnedEffect;
  says: string;
};

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export function practiceLearned(history: TopicHistory): Learned[] {
  return (Object.keys(PRACTICE_TOPIC) as Kind[]).flatMap((kind) => {
    const topic = PRACTICE_TOPIC[kind];
    const h = history[topic];
    if (!h || h.yes + h.no === 0) return [];
    const factor = historyFactor(topic, history);
    const floor = HISTORY_FLOOR_BY_TOPIC[topic];
    const effect: LearnedEffect =
      floor !== undefined && h.no > 0 && factor < 1
        ? "safety"
        : factor > 1
          ? "sooner"
          : factor < 1
            ? "later"
            : "same";
    const answered = [h.yes > 0 && `yes ${times(h.yes)}`, h.no > 0 && `no ${times(h.no)}`]
      .filter(Boolean)
      .join(" and ");
    const then = {
      sooner: "so Jane brings these sooner.",
      later: "so Jane brings these later, and never asks again about one you turned down.",
      safety: "but it's a safety check, so Jane still brings it, just less often.",
      same: "so nothing has changed yet.",
    }[effect];
    return [
      {
        kind,
        label: SCAN_LABELS[kind as ScanKind],
        yes: h.yes,
        no: h.no,
        factor: Math.round(factor * 100) / 100,
        effect,
        says: `You said ${answered}, ${then}`,
      },
    ];
  });
}
