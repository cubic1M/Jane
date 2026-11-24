import { TRIAL_ID_PREFIX } from "@/config/trial";
import { NOT_FROM_A_BANK } from "@/data-sources/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { peopleIn } from "@/lib/only-people";
import { systemDb } from "@/lib/system-db";
import { whyNoDigest, type NoDigestReason } from "./recipients";

const WHY = "Cron: finds who an email goes to, across people";

// Who a cron's email goes to: people with the switch on, not deleted, at least one account, never a
// trial person, and then (whyNoDigest, ./recipients.ts) never someone whose only bank is the demo
// bank. The weekly email and the daily report share it, each with its own switch.
export async function loadRecipients(
  client: PrismaClient,
  switchName: "digestEnabled" | "dailyReportEnabled",
  userIds?: readonly string[],
) {
  const candidates = await systemDb(WHY, client).user.findMany({
    where: {
      [switchName]: true,
      deletedAt: null,
      accounts: { some: {} },
      NOT: { id: { startsWith: TRIAL_ID_PREFIX } },
      ...peopleIn(userIds),
    },
    select: {
      id: true,
      email: true,
      timezone: true,
      createdAt: true,
      deletedAt: true,
      plaidItems: { select: { plaidItemId: true } },
      _count: { select: { accounts: true } },
    },
    orderBy: { id: "asc" },
  });
  const csvAccounts = await systemDb(WHY, client).account.groupBy({
    by: ["userId"],
    where: { source: { in: [...NOT_FROM_A_BANK] }, userId: { in: candidates.map((c) => c.id) } },
    _count: { _all: true },
  });
  const csvCount = new Map(csvAccounts.map((a) => [a.userId, a._count._all]));
  const excluded: Partial<Record<NoDigestReason, number>> = {};
  const users = candidates.filter((c) => {
    const reason = whyNoDigest({
      ...c,
      // The query already kept only people with the switch on.
      digestEnabled: true,
      plaidItemIds: c.plaidItems.map((i) => i.plaidItemId),
      csvAccounts: csvCount.get(c.id) ?? 0,
      accounts: c._count.accounts,
    });
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    return reason === null;
  });
  return { users, excluded };
}
