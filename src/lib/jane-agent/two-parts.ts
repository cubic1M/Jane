import { parseIntent, type Intent } from "./intents";
import type { Reply } from "./replies";

// Two questions in one message (spec step 193): "how much can I spend and when is payday".
// Without Claude, the rules answer each part and put the answers together. Only when every
// part is a question the rules understand on its own, of a different kind (so "what's due
// this week and next" stays one question), and none is an action (those make a plan, spec
// step 185). Pure.

const SPLIT = /\s*(?:,? and then |,? and also |,? and |;\s*|\?\s+)/;
const ACTIONS: readonly string[] = ["act", "multi", "move_to_goal", "approve_all", "undo", "flow"];
const NOT_A_QUESTION: readonly string[] = ["unknown", "follow_up", "help", "greeting", "remember", "about"];

export function splitQuestions(text: string, asOf: string): Intent[] | null {
  const pieces = text
    .split(SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pieces.length < 2 || pieces.length > 3) return null;
  const intents = pieces.map((p) => parseIntent(p, asOf, { single: true }));
  if (intents.some((i) => NOT_A_QUESTION.includes(i.kind) || ACTIONS.includes(i.kind))) return null;
  if (new Set(intents.map((i) => i.kind)).size < intents.length) return null;
  return intents;
}

// The answers one after the other, with the first answer's first sentence still first.
export function joinReplies(replies: Reply[]): Reply {
  const seen = new Set<string>();
  const actions = replies
    .flatMap((r) => r.actions)
    .filter((a) => {
      const key = `${a.id}:${a.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    body: replies.map((r) => r.body).join("\n\n"),
    actions,
    refs: replies[0].refs,
  };
}
