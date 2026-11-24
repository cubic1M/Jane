import {
  EXPLAIN_HIGH_LOOKBACK,
  EXPLAIN_MONTHLY_GAP_DAYS,
  EXPLAIN_USUAL_WINDOW,
} from "@/config/agent-chat";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { chargesFor, type BillLine } from "./replies-old-bills";
import type { Reply } from "./replies";
import { openLink } from "./types";

// "Why did I pay $100 to Vercel?" (founder, 11-24): one merchant's charges said the way a person
// would: what was paid and when, what's usual, what's different this time and since when. From the
// person's own charges, matched the way the old-statements and last-charge answers match them. What
// the bank's line can't say (why) is said, with the way to find out: the invoice (./invoice-reader.ts).
// The backup and Claude's explain_charge tool read the same function. Pure.

export type ChargeAsked = {
  amountCents: number | null;
  day: string | null;
  // "Why was it so high?": no amount, so the high one among the latest few.
  high?: boolean;
  // That exact transaction (the invoice page's link): the amount and day can match several in a day.
  id?: string;
};

export type ChargeExplanation = {
  // As asked ("Vercel"), not the bank's cleaned name, which can keep a processor's word.
  name: string;
  charge: { id: string | null; date: string; cents: number };
  chargesSeen: number;
  // What it was before this charge (or the run of equal charges it is part of): null when nothing is.
  usual: { cents: number; exact: boolean; monthly: boolean } | null;
  // This charge minus the usual: positive is more.
  differenceCents: number | null;
  // Above every charge before it, including the equal ones just before it.
  highest: boolean;
  // How many equal charges in a row it is part of, and the day the run began.
  run: { count: number; since: string };
  // The charge after it, when it isn't the same amount.
  next: { date: string; cents: number } | null;
};

export type ChargeLookup =
  | { kind: "none" }
  // Charges by that name, but not one of that amount or day: its latest.
  | { kind: "no_match"; name: string; latest: { date: string; cents: number } }
  | { kind: "found"; explanation: ChargeExplanation };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const titled = (target: string) => target.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function lookUpCharge(
  target: string,
  lines: readonly BillLine[],
  asked: ChargeAsked,
): ChargeLookup {
  const charges = chargesFor(target, lines);
  if (charges.length === 0) return { kind: "none" };
  const name = titled(target);
  let pool = charges;
  if (asked.amountCents !== null) pool = pool.filter((t) => t.amountCents === asked.amountCents);
  if (asked.day) {
    const exact = pool.filter((t) => t.date === asked.day);
    pool = exact.length > 0 ? exact : pool.filter((t) => Math.abs(days(asked.day!, t.date)) <= 1);
  }
  const last = charges[charges.length - 1]!;
  const exact = asked.id ? charges.find((t) => t.id === asked.id) : undefined;
  if (pool.length === 0 && !exact) {
    return { kind: "no_match", name, latest: { date: last.date, cents: last.amountCents } };
  }
  // No amount or day: the latest, or for "so high" the biggest of the last few.
  const chosen =
    exact ??
    (asked.amountCents === null && !asked.day && asked.high
      ? charges
          .slice(-EXPLAIN_HIGH_LOOKBACK)
          .reduce((best, t) => (t.amountCents >= best.amountCents ? t : best))
      : pool[pool.length - 1]!);
  const at = charges.indexOf(chosen);
  let start = at;
  while (start > 0 && charges[start - 1]!.amountCents === chosen.amountCents) start -= 1;
  let end = at;
  while (end < charges.length - 1 && charges[end + 1]!.amountCents === chosen.amountCents) end += 1;
  const before = charges.slice(0, start);

  // The run just before this one when it is steady, else the middle of the last few before.
  let usual: ChargeExplanation["usual"] = null;
  if (before.length > 0) {
    let runStart = before.length - 1;
    while (runStart > 0 && before[runStart - 1]!.amountCents === before[runStart]!.amountCents) {
      runStart -= 1;
    }
    const steady = before.length - runStart >= 2 || before.length === 1;
    const gaps = charges
      .slice(0, at + 1)
      .flatMap((t, i, all) => (i ? [days(all[i - 1]!.date, t.date)] : []));
    const [low, high] = EXPLAIN_MONTHLY_GAP_DAYS;
    const gap = gaps.length > 0 ? median(gaps) : null;
    usual = {
      cents: steady
        ? before[before.length - 1]!.amountCents
        : median(before.slice(-EXPLAIN_USUAL_WINDOW).map((t) => t.amountCents)),
      exact: steady,
      monthly: gap !== null && gap >= low && gap <= high,
    };
  }
  const after = charges[end + 1];
  return {
    kind: "found",
    explanation: {
      name,
      charge: { id: chosen.id ?? null, date: chosen.date, cents: chosen.amountCents },
      chargesSeen: charges.length,
      usual,
      differenceCents: usual ? chosen.amountCents - usual.cents : null,
      // Above every charge before it, the ones in its own run too: the third $100 isn't a first.
      highest:
        at > 0 && chosen.amountCents > Math.max(...charges.slice(0, at).map((t) => t.amountCents)),
      run: { count: end - start + 1, since: charges[start]!.date },
      next: after ? { date: after.date, cents: after.amountCents } : null,
    },
  };
}

// The same words wherever the answer is read (the backup's reply and what Claude's tool says).
export function explanationWords(e: ChargeExplanation): string[] {
  const money = formatCents;
  const lines = [`You paid ${e.name} ${money(e.charge.cents)} on ${dayLabel(e.charge.date)}.`];
  if (e.chargesSeen === 1) {
    lines.push(`It's the only charge from ${e.name} I see, so I can't say what's usual yet.`);
  } else if (!e.usual && e.run.count >= 2) {
    // The earliest charges I see are all the same: nothing earlier, and nothing different.
    lines.push(
      `It has been ${money(e.charge.cents)} each time since ${dayLabel(e.run.since)} (${e.run.count} charges): nothing is different about this one.`,
    );
  } else if (!e.usual) {
    lines.push(
      `It's the earliest charge from ${e.name} I see (${e.chargesSeen} in all), so I can't compare it with an earlier one.`,
    );
  } else if (e.differenceCents === 0) {
    lines.push(
      `That's the same as your usual ${money(e.usual.cents)}${e.usual.monthly ? " a month" : ""}: nothing is different about this one.`,
    );
  } else {
    const diff = e.differenceCents!;
    const steady = e.run.count >= 2;
    const usual = `${e.usual.exact ? "" : "about "}${money(e.usual.cents)}${e.usual.monthly ? " a month" : ""}`;
    const tail = steady
      ? `it went ${diff > 0 ? "up" : "down"} on ${dayLabel(e.run.since)} and has been ${money(e.charge.cents)} each time since (${e.run.count} charges)`
      : diff > 0 && e.highest
        ? "it is the first time it has been this high in what I can see"
        : null;
    lines.push(
      `You ${steady ? "used to" : "usually"} pay it ${usual}, so this is ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than usual${tail ? `; ${tail}` : ""}.`,
    );
  }
  if (e.next && (!e.usual || e.next.cents !== e.charge.cents)) {
    lines.push(`The charge after it, on ${dayLabel(e.next.date)}, was ${money(e.next.cents)}.`);
  }
  return lines;
}

// What the bank's line can't say, and what can: said the same way every time.
export const BANK_LINE_NOTE = "Your bank's line shows only who was paid and how much, not why.";
export const GENERAL_RISE_NOTE =
  "In general, a bill can rise when usage is added to a plan fee, but that's general: I can't tell it from your bank's line.";

export function invoiceOffer(e: ChargeExplanation): string {
  const extra = e.differenceCents !== null && e.differenceCents > 0;
  return `If you have the invoice, open the invoice page and paste its text: I'll list its line items and name the one that explains ${extra ? `the extra ${formatCents(e.differenceCents!)}` : "this charge"}.`;
}

export const invoiceHref = (e: ChargeExplanation) =>
  e.charge.id ? `/invoice?charge=${encodeURIComponent(e.charge.id)}` : "/invoice";

export function chargeExplainReply(
  lookup: ChargeLookup,
  asked: ChargeAsked,
  target: string,
): Reply {
  const seeAll = openLink(
    "See your transactions",
    `/transactions?q=${encodeURIComponent(titled(target))}`,
  );
  if (lookup.kind === "none") {
    return {
      body: `I don't see a charge from ${titled(target)} in what I have, so I can't tell you what it was from my data.`,
      actions: [seeAll],
      refs: {},
    };
  }
  if (lookup.kind === "no_match") {
    const what =
      asked.amountCents !== null
        ? `a ${formatCents(asked.amountCents)} charge from ${lookup.name}${asked.day ? ` on ${dayLabel(asked.day)}` : ""}`
        : `a charge from ${lookup.name} on ${dayLabel(asked.day!)}`;
    return {
      body: `I don't see ${what}. Its latest was ${formatCents(lookup.latest.cents)} on ${dayLabel(lookup.latest.date)}.`,
      actions: [seeAll],
      refs: {},
    };
  }
  const e = lookup.explanation;
  const body = [
    ...explanationWords(e),
    BANK_LINE_NOTE,
    ...(e.differenceCents !== null && e.differenceCents > 0 ? [GENERAL_RISE_NOTE] : []),
    invoiceOffer(e),
  ].join(" ");
  return {
    body,
    actions: [openLink("Read the invoice", invoiceHref(e)), seeAll],
    refs: {},
  };
}
