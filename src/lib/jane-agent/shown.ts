import type { ChatMessage } from "./types";

// What a tap's page was showing, sent back with each tap (the `shown` field) so a yes acts on
// what the card said: one student step, or one saving's terms. A tap whose token no longer
// matches (a stale tab, the figures moved) is refused, as refs.flow.shown does for flows.

type Shown = Pick<ChatMessage, "refs" | "body" | "actions">;

// The step a student message shows; an older message names it in its text.
export function studentStepOf({ refs, body }: Pick<Shown, "refs" | "body">): number | null {
  const step = refs.studentStep ?? Number(/step (\d+) of/.exec(body)?.[1]) - 1;
  return Number.isInteger(step) && step >= 0 ? step : null;
}

export const studentToken = (step: number) => `student:${step}`;
export const savingToken = (id: string, terms: string) => `saving:${id}:${terms}`;

export function shownTokenOf(message: Shown): string | undefined {
  const { refs } = message;
  if (refs.savingId && refs.savingTerms?.[refs.savingId]) {
    return savingToken(refs.savingId, refs.savingTerms[refs.savingId]!);
  }
  if (message.actions.some((a) => a.id === "student.next")) {
    const step = studentStepOf(message);
    return step === null ? undefined : studentToken(step);
  }
  return undefined;
}
