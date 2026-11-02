import type { DetectionInput } from "@/detection/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isoDay } from "@/lib/dates";
import { statementCoverage } from "@/lib/outcomes";
import { freshnessOf, type Freshness } from "@/planning/freshness";

// A person's uploaded statements, as far as they reach (src/planning/freshness.ts).
export async function loadFreshness(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    input,
  }: { client?: PrismaClient; now?: Date; input?: Pick<DetectionInput, "transactions"> } = {},
): Promise<Freshness> {
  const db = scopedFor(userId, client);
  const accounts = await db.accounts.findMany({
    select: { id: true, name: true, source: true, itemId: true },
  });
  const uploaded = accounts.filter((a) => a.itemId === null && a.source === "csv");
  const hasBank = accounts.some((a) => a.itemId !== null);
  const asOf = isoDay(now);
  if (uploaded.length === 0) return freshnessOf([], { hasBank, asOf });
  const coverage = await statementCoverage(
    userId,
    input ?? {
      // Only the newest line of each account matters here.
      transactions: (
        await db.transactions.groupBy({
          by: ["accountId"],
          where: { accountId: { in: uploaded.map((a) => a.id) }, pending: false },
          _max: { date: true },
        })
      ).flatMap((t) =>
        t._max.date
          ? [
              {
                accountId: t.accountId,
                date: isoDay(t._max.date),
              } as DetectionInput["transactions"][number],
            ]
          : [],
      ),
    },
    { client, now },
  );
  return freshnessOf(
    uploaded.map((a) => ({ id: a.id, name: a.name, coveredThrough: coverage[a.id] ?? null })),
    { hasBank, asOf },
  );
}
