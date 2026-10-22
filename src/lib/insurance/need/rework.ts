import { EVENT_NEEDS, EVENT_REASONS } from "@/config/insurance";
import type { Need } from "./types";

// Kept perfect (spec step 280): the needs are worked out fresh from the profile every time, so a
// new child (the profile's has_children) opens the life-cover gap the same day. This names the
// gaps a recent life event can have opened, with the reason in the person's words. Pure, and it
// only reads: nothing is bought, a pick is always a tap.

export type OpenedGap = { need: Need; event: string; because: string };

export const isOpen = (n: Need) => (n.direction ? n.direction !== "ok" : n.gapCents > 0);

export function openedGaps(needs: readonly Need[], events: readonly string[]): OpenedGap[] {
  const out: OpenedGap[] = [];
  for (const need of needs) {
    if (!isOpen(need)) continue;
    const event = events.find((e) => EVENT_NEEDS[e]?.includes(need.kind));
    if (event) out.push({ need, event, because: EVENT_REASONS[event] ?? event });
  }
  return out;
}
