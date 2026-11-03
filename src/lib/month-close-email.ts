import { MONTH_CLOSE_EMAIL_LINES } from "@/config/month-close";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadMonthClose } from "@/lib/close";
import { db as defaultClient } from "@/lib/db";
import { dayLabel, monthLabel } from "@/lib/day-label";
import { loadFreshness } from "@/lib/freshness";
import type { LedgerEntry } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { loadClose, runMonthClose } from "@/lib/month-close";
import { CHANGE_LABEL, type MonthClose } from "@/planning/close";
import { plural } from "@/lib/plural";

// The month close as one email (Stage 1): books balanced, what changed, what's fixed, what's still
// open. It's the month's one email (src/lib/monthly-report.ts), for those who get Jane's emails.
// Rules only, no Claude call.

type Options = { client?: PrismaClient; now?: Date };

export type CloseEmail = {
  month: string;
  sections: { heading: string; lines: string[] }[];
  // How far the statements reach, when they stop before the month does.
  reach: string | null;
};

// What the books said at the close.
export function booksLines(figures: { booksOpen: number }, waiting: number): string[] {
  return [
    ...(figures.booksOpen > 0
      ? [
          `${plural(figures.booksOpen, "thing")} didn't add up, so the figures that rely on them are marked.`,
        ]
      : ["Everything added up."]),
    ...(waiting > 0 ? [`${plural(waiting, "charge")} to confirm before the month can close.`] : []),
  ];
}

const money = (e: Pick<LedgerEntry, "cents" | "yearly">) =>
  `${formatCents(e.cents)}${e.yearly ? "/yr" : ""}`;
const STATE_WORDS: Partial<Record<LedgerEntry["state"], string>> = {
  said_yes: "You said yes",
  done: "Done, checking",
  estimated: "Still to do",
};

// A list that says how many more there are past what fits.
function capped(lines: string[]): string[] {
  if (lines.length <= MONTH_CLOSE_EMAIL_LINES) return lines;
  const shown = lines.slice(0, MONTH_CLOSE_EMAIL_LINES);
  return [...shown, `And ${lines.length - shown.length} more.`];
}

export function closeSections(
  close: Pick<MonthClose<LedgerEntry>, "changed" | "verified" | "open">,
  books: string[],
): CloseEmail["sections"] {
  return [
    { heading: "Books", lines: books },
    {
      heading: "What changed",
      lines: close.changed.length
        ? capped(
            close.changed.map(
              (c) =>
                `${CHANGE_LABEL[c.kind]}: ${c.title} (${formatCents(c.amountCents)}${c.usualCents ? `, usually ${formatCents(c.usualCents)}` : ""}; ${c.sure} sure)`,
            ),
          )
        : ["Nothing new."],
    },
    {
      heading: "What's fixed",
      lines: close.verified.length
        ? capped(close.verified.map((e) => `${e.title}: ${money(e)}, shown in your transactions`))
        : ["Nothing newly verified."],
    },
    {
      heading: "What's still open",
      lines: close.open.length
        ? capped(
            close.open.map(
              (e) =>
                `${STATE_WORDS[e.state] ?? "Still to do"}: ${e.title}${e.cents > 0 ? ` (about ${money(e)})` : ""}${e.confidencePercent ? `; ${e.confidencePercent}% sure` : ""}`,
            ),
          )
        : ["Nothing left open."],
    },
  ];
}

export async function loadCloseEmail(
  userId: string,
  month: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CloseEmail | null> {
  // The nightly run usually got there first; the email never goes out ahead of the close.
  await runMonthClose(userId, { client, now });
  const [view, close, freshness] = await Promise.all([
    loadClose(userId, { client, now, month }),
    loadMonthClose(userId, month, { client, now }),
    loadFreshness(userId, { client, now }),
  ]);
  if (!view || view.month !== month) return null;
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  return {
    month,
    sections: closeSections(close, booksLines(view.figures, view.uncertain.length)),
    reach:
      freshness.newest && freshness.newest < monthEnd && freshness.uploadOnly
        ? `Your statements end ${dayLabel(freshness.newest)}, so this close only covers up to then.`
        : null,
  };
}

export const closeSubject = (month: string) => `Your ${monthLabel(month, { long: true })} close`;
