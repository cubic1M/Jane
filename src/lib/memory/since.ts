import { momentLabel } from "@/lib/day-label";

// "since Dec 31, 2026" on What Jane knows: the day Jane first learned a fact, as the person's own
// day in their timezone. In UTC an answer given the evening of Dec 31 in Los Angeles read "since
// Jan 1, 2027" (walk on da81c3495).
export const sinceLabel = (firstSeen: Date, timezone: string): string =>
  momentLabel(firstSeen, timezone, { year: true });
