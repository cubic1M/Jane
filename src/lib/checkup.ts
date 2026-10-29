import { checkup, type CheckLine } from "@/detection/checkup";
import { loadDetectionInput } from "@/detection/engine";
import type { FindingType, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The report's checkup for one person (src/detection/checkup.ts). Read-only: the same input the
// scan reads, and the subscription answers Claude already gave, so it never calls Claude.
// `open` is the findings the report lists, so their checks always say found.
export async function loadCheckup(
  userId: string,
  open: readonly FindingType[],
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<CheckLine[]> {
  const [input, answers] = await Promise.all([
    loadDetectionInput(userId, { client, now }),
    scopedFor(userId, client).subscriptionChecks.findMany({
      select: { merchantKey: true, isSubscription: true },
    }),
  ]);
  const keys = (answer: boolean) =>
    answers
      .filter((a) => a.isSubscription === answer)
      .map((a) => a.merchantKey)
      .sort();
  input.subscriptionMerchantKeys = keys(true);
  input.declinedSubscriptionMerchantKeys = keys(false);
  const counts: Partial<Record<FindingType, number>> = {};
  for (const type of open) counts[type] = (counts[type] ?? 0) + 1;
  return checkup(input, counts);
}
