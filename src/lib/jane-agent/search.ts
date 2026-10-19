import { CHAT_PAGE_SIZE, CHAT_SEARCH_RESULTS } from "@/config/agent-chat";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import { BUNDLED_UNTIL } from "./messages";
import { localTime } from "./quiet-hours";

// Searching the chat (spec step 96): by words (a merchant is a word), an amount ("$17.99",
// "17.99") or a day ("Oct 20", "2026-10-20"). Only ever the person's own messages: every
// query goes through the scoped helper.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type SearchQuery = { words: string[]; amountCents: number | null; date: string | null };

// What the person typed, as words, an amount and a day. The year of a day without one is
// the last one that's passed (asOf, YYYY-MM-DD).
export function parseSearch(raw: string, asOf: string): SearchQuery {
  let text = ` ${raw.toLowerCase().trim()} `;
  let amountCents: number | null = null;
  const money =
    /\s\$?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s|\s\$((?:\d{1,3}(?:,\d{3})+|\d+))\s/.exec(text);
  if (money) {
    amountCents = parseMoneyToCents(money[1] ?? money[2]);
    text = text.replace(money[0], " ");
  }
  let date: string | null = null;
  const iso = /\s(\d{4}-\d{2}-\d{2})\s/.exec(text);
  const named =
    /\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\s/.exec(
      text,
    );
  if (iso) {
    date = iso[1];
    text = text.replace(iso[0], " ");
  } else if (named) {
    const month = String(MONTHS.indexOf(named[1]) + 1).padStart(2, "0");
    const day = named[2].padStart(2, "0");
    const year = Number(asOf.slice(0, 4));
    const thisYear = `${year}-${month}-${day}`;
    date = thisYear <= asOf ? thisYear : `${year - 1}-${month}-${day}`;
    text = text.replace(named[0], " ");
  }
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9$]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w.length >= 2);
  return { words, amountCents, date };
}

export type SearchResult = {
  id: string;
  kind: string;
  body: string;
  createdAt: Date;
  // Where it is in the chat: the "Show earlier" pages needed to see it, and its anchor.
  href: string;
};

export async function searchChat(
  userId: string,
  raw: string,
  {
    client = defaultClient,
    now = new Date(),
    timezone = null,
  }: { client?: PrismaClient; now?: Date; timezone?: string | null } = {},
): Promise<SearchResult[]> {
  const query = parseSearch(raw, localTime(now, timezone).date);
  if (query.words.length === 0 && query.amountCents === null && query.date === null) return [];
  const where: Prisma.JaneMessageWhereInput[] = [
    // Never what's hidden behind a bundle (spec step 92).
    { OR: [{ snoozedUntil: null }, { snoozedUntil: { not: BUNDLED_UNTIL } }] },
    ...query.words.map((w) => ({ body: { contains: w, mode: "insensitive" as const } })),
  ];
  if (query.amountCents !== null) {
    where.push({ body: { contains: formatCents(query.amountCents) } });
  }
  if (query.date) {
    // That day in the person's timezone: from a day before to a day after in UTC, then
    // kept by its local date.
    const day = Date.parse(`${query.date}T00:00:00Z`);
    where.push({
      createdAt: { gte: new Date(day - 86_400_000), lt: new Date(day + 2 * 86_400_000) },
    });
  }
  const db = scopedFor(userId, client);
  const rows = (
    await db.janeMessages.findMany({
      where: { AND: where },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CHAT_SEARCH_RESULTS * 2,
      select: { id: true, kind: true, body: true, createdAt: true },
    })
  )
    .filter((r) => !query.date || localTime(r.createdAt, timezone).date === query.date)
    .slice(0, CHAT_SEARCH_RESULTS);
  return Promise.all(
    rows.map(async (r) => {
      // How many messages are newer: that's how far back the chat has to show.
      const newer = await db.janeMessages.count({
        where: {
          createdAt: { gt: r.createdAt },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        },
      });
      const pages = Math.floor(newer / CHAT_PAGE_SIZE) + 1;
      return { ...r, href: `/chat${pages > 1 ? `?pages=${pages}` : ""}#${r.id}` };
    }),
  );
}
