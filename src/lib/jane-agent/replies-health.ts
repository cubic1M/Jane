import { HEALTH_NEVER_SAY } from "@/config/health-score";
import type { HealthView } from "@/lib/health-score";
import type { HealthPartScore } from "@/planning/health-score";
import type { Reply } from "./replies";
import { sentence } from "./sources/source";
import type { MessageAction } from "./types";
import { monthLabel } from "@/lib/day-label";

// Money health score in the chat (spec step 146): the number, the band, how it moved since
// last month and what moved it, and the one step that would raise it most. Kind words
// only: a low part is room to grow, never a verdict.

const SEE: MessageAction = {
  id: "open",
  label: "See how it's made",
  kind: "link",
  href: "/jane#health",
};

// The part with the most room, and its next step.
export const mostRoom = (parts: HealthPartScore[]) =>
  [...parts].filter((p) => p.next).sort((a, b) => b.max - b.points - (a.max - a.points))[0] ?? null;

export function scoreLine(view: Pick<HealthView, "score" | "band">) {
  return `Your money health score is ${view.score} out of 100 (${view.band}).`;
}

export function changeLine(view: HealthView): string | null {
  if (!view.before || !view.change) return null;
  const { delta, biggest } = view.change;
  const since = `since ${monthLabel(view.before.month, { long: true, year: false })}`;
  if (delta === 0)
    return `That's the same as ${monthLabel(view.before.month, { long: true, year: false })}.`;
  const why = biggest ? `, mostly from ${biggest.label.toLowerCase()}` : "";
  return delta > 0
    ? `That's up ${delta} ${since}${why}.`
    : `That's ${-delta} lower ${since}${why}.`;
}

const kind = (text: string) => {
  if (HEALTH_NEVER_SAY.test(text)) throw new Error("A health score line judged the person.");
  return text;
};

export function healthReply(view: HealthView | null): Reply {
  if (!view) {
    return {
      body: "Once your accounts are linked, I'll work out your money health score: one number out of 100 for your cushion, room each month, bills on time, card balances and goals.",
      actions: [],
      refs: {},
    };
  }
  const parts = view.parts.map((p) => `${p.label}: ${p.points} of ${p.max}. ${sentence(p.why)}`);
  const room = mostRoom(view.parts);
  const lines = [
    scoreLine(view),
    changeLine(view),
    ...parts,
    room ? `To raise it: ${room.next}` : "Every part is full. Nice work.",
    view.left.length > 0
      ? `Not counted yet: ${view.left.map((l) => l.label.toLowerCase()).join(", ")}.`
      : null,
  ].filter((l): l is string => Boolean(l));
  return { body: kind(lines.join(" ")), actions: [SEE], refs: {} };
}

// The monthly note, or the first time: the score, the move, and the one step.
export function healthNote(view: HealthView): Reply {
  const room = mostRoom(view.parts);
  const lines = [
    scoreLine(view),
    changeLine(view),
    room ? `The most room is in ${room.label.toLowerCase()}: ${room.next}` : null,
  ].filter((l): l is string => Boolean(l));
  return { body: kind(lines.join(" ")), actions: [SEE], refs: {} };
}
