import type { Candidate } from "../types";
import type { LocalTime } from "../quiet-hours";
import type { Snapshot } from "../snapshot";

// A message source (spec step 82): one kind of thing Jane can bring up. Each looks at the
// snapshot and returns what it would say; Jane's brain (../brain.ts) picks what to post.
// Sources are pure: no database, no clock but the one passed in.

// What started this run: the person opening the chat, a bank sync, a CSV import or the
// daily job.
export type Trigger = "open" | "sync" | "import" | "cron";

export type SourceContext = {
  now: Date;
  // The person's own date and hour.
  local: LocalTime;
  trigger: Trigger;
};

// dedupeKey here is the source's own; the brain puts the source's key in front.
export type MessageSource = {
  key: string;
  gather(snapshot: Snapshot, context: SourceContext): Candidate[];
};

// "1 thing", "3 things".
export const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

// A title as a sentence: ends with a full stop unless it already ends in punctuation.
export const sentence = (text: string) =>
  /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

// "Oct 31".
export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// "today", "tomorrow", "in 2 days".
export const inDays = (days: number) =>
  days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
