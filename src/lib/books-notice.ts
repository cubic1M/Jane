import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { BooksView } from "@/lib/books";

// The box on Home that says some figures rely on data Jane is still checking: a person can close
// it, and it stays closed on later visits until the problems it names change (founder 11-24). Kept
// in change_acks, which already holds "that's expected" per person: no table of its own. The key
// names the set of problems shown, so a problem fixed or a new one found makes a new key, and the
// box comes back.

export const BOOKS_NOTICE_KIND = "books_notice";
const KEY = /^books_notice:[0-9a-f]{16}$/;

// The problems the box names: every open one that isn't a transfer, minus banks whose trouble Home
// says elsewhere (its bank notice).
export function worryingBooks(books: BooksView, skipItems: readonly string[] = []) {
  return books.open.filter(
    (o) => o.kind !== "transfer" && !(o.itemId && skipItems.includes(o.itemId)),
  );
}

export function booksNoticeKey(problemIds: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...problemIds].sort().join("|"))
    .digest("hex");
  return `books_notice:${digest.slice(0, 16)}`;
}

type Options = { client?: PrismaClient };

export async function booksNoticeClosed(
  userId: string,
  key: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  return (await scopedFor(userId, client).changeAcks.count({ where: { key } })) > 0;
}

// Closing it forgets any earlier closing, so the person has at most one row for it.
export async function closeBooksNotice(
  userId: string,
  key: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  if (!KEY.test(key)) throw new Error("That note isn't there anymore.");
  const db = scopedFor(userId, client);
  await db.changeAcks.deleteMany({ where: { kind: BOOKS_NOTICE_KIND, key: { not: key } } });
  await db.changeAcks.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, kind: BOOKS_NOTICE_KIND },
    update: {},
  });
}
