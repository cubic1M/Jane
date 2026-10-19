import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { LIFE_EVENTS } from "@/config/life-events";
import type { LifeGuess } from "@/insights/life-signals";
import { lifeOffer } from "../replies-life";
import type { Candidate } from "../types";
import type { MessageSource } from "./source";

// Life events spotted (spec step 100): Jane asks once about each one she has two or more
// signs of, with Yes (she runs the checklist herself), Not me and Don't ask again.

const list = (items: string[]) =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const QUESTION = {
  moving: "Are you moving?",
  new_job: "Did you start a new job?",
  new_baby: "Is there a new baby on the way, or just arrived?",
} as const;

function ask(guess: LifeGuess): Candidate {
  const title = LIFE_EVENTS[guess.kind].title.toLowerCase();
  return {
    kind: "decision",
    body: `I noticed ${list(guess.signals.map((s) => s.text))}. ${QUESTION[guess.kind]} If so, ${lifeOffer(guess.kind)} Tap Yes and I'll start your ${title} checklist.`,
    refs: { lifeKind: guess.kind },
    actions: [
      { id: "life.yes", label: "Yes", kind: "primary" },
      { id: "life.no", label: "Not me", kind: "secondary" },
      { id: "life.never", label: "Don't ask again", kind: "secondary" },
    ],
    dedupeKey: guess.kind,
    priority: MESSAGE_PRIORITY.life_event,
  };
}

export const lifeSource: MessageSource = {
  key: "life",
  gather: (snapshot) => (snapshot.lifeGuesses ?? []).map(ask),
};
