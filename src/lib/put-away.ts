import { UNDO_NEVER, UNDO_SNOOZE } from "@/config/put-away";

// A card put away (Not now, the ✕, a swipe or Escape, or "Don't suggest this again") leaves a line
// in its place that brings it back (founder, 11-16: "there should be an option to go back to the
// suggestion that they just clicked close"). The line stays until another card is answered or the
// page is left; bringing it back undoes whatever putting it away told the server
// (src/lib/jane-agent/actions/undo.ts). Yes starts something, so it leaves no line.

// The way back from an answer: the server action that reverses it, null when it only put the card
// off on this screen (nothing was sent), or false when there is none (a practice idea's no, or a
// card's own answer that isn't a put-away).
export function undoOf(
  actionId: string | null | undefined,
  { practice = false }: { practice?: boolean } = {},
): string | null | false {
  if (actionId === undefined || actionId === null) return null;
  if (actionId === "snooze") return UNDO_SNOOZE;
  if (actionId === "suggestion.no") return practice ? false : UNDO_NEVER;
  return false;
}

// The card whose line is showing: where it was among the cards, and what brings it back.
export type Away<T> = { item: T; index: number; undo: string | null };

// After an answer: a put-away that can be taken back leaves its line; any other answer (another
// card's Yes or put-away) takes the last line away.
export function afterAnswer<T extends { id: string }>(
  items: readonly T[],
  id: string,
  how: "yes" | "not_now" | "never",
  undo: string | null | false,
): Away<T> | null {
  if (how === "yes" || undo === false) return null;
  const index = items.findIndex((m) => m.id === id);
  return index < 0 ? null : { item: items[index], index, undo };
}

// The cards to show: those not dealt with, and each one brought back at the place it had, even
// when a reload since has left it out (its put-away reached the server first).
export function withReturned<T extends { id: string }>(
  shown: readonly T[],
  returned: readonly Away<T>[],
  gone: ReadonlySet<string>,
): T[] {
  const out = [...shown];
  for (const r of [...returned].sort((a, b) => a.index - b.index)) {
    if (gone.has(r.item.id) || out.some((m) => m.id === r.item.id)) continue;
    out.splice(Math.min(r.index, out.length), 0, r.item);
  }
  return out;
}
