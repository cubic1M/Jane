import { BILL_KINDS } from "@/config/agent-chat";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { merchantOf } from "@/detection/streams";
import { SUBSCRIPTION_CATEGORIES } from "@/detectors/money";
import type { Reply } from "./replies";
import { openLink } from "./types";

// Two backup-chat answers that said too little (walk notes, phone passes 6 and 7): on statements
// that ended long ago, "how much is my internet bill?" said only "I can't see November: what I have
// ends on Sep 28", leaving out the $55.00 Xfinity the statements show; and on a month of data, "what
// subscriptions do I have?" said none could be told, though Hulu and ChatGPT were each charged once.
// Pure.

export type BillLine = {
  date: string;
  // Money out is positive, as the detection input has it.
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
};

const nameOf = (t: BillLine) =>
  merchantOf({ merchantName: t.merchantName, description: t.description })?.name ?? null;
const words = (text: string) =>
  ` ${text
    .toLowerCase()
    .split(/[^a-z0-9&+']+/)
    .filter(Boolean)
    .join(" ")} `;

// "How much is my internet bill?" on statements that end `statementsEnd`: what they show, said as
// of then. Null when they show nothing by that name or kind.
export function fromOldStatementsReply(
  target: string,
  lines: readonly BillLine[],
  statementsEnd: string,
): Reply | null {
  const kind = BILL_KINDS[target.toLowerCase().replace(/ bill$/, "")];
  const charges = lines
    .filter((t) => t.amountCents > 0)
    .filter((t) => (kind ? t.pfcDetailed === kind : words(nameOf(t) ?? "").includes(words(target))))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = charges.at(-1);
  if (!last) return null;
  const name = nameOf(last) ?? target;
  const same = charges.filter((t) => nameOf(t) === nameOf(last));
  const monthly = same.length >= 2 && same.every((t) => t.amountCents === last.amountCents);
  return {
    body: `In your statements, which end ${dayLabel(statementsEnd)}, ${name} was ${formatCents(last.amountCents)}${
      monthly ? " a month" : ""
    } (last on ${dayLabel(last.date)}). Whether it's the same now I can't tell from them.`,
    actions: [openLink("Upload newer statements", "/import")],
    refs: {},
  };
}

// On too little history to call anything a subscription: the charges of a subscription's kind seen
// so far, once each, by name.
export function seenOnceSubscriptions(lines: readonly BillLine[]): string[] {
  const seen = new Map<string, number>();
  for (const t of lines) {
    if (t.amountCents <= 0 || !SUBSCRIPTION_CATEGORIES.has(t.pfcDetailed ?? "")) continue;
    const name = nameOf(t);
    if (name && !seen.has(name)) seen.set(name, t.amountCents);
  }
  return [...seen].map(([name, cents]) => `${name} ${formatCents(cents)}`);
}
