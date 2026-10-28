import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { investingLeak, type Leak } from "@/planning/investing-leak";

// The investing leak for one person (src/planning/investing-leak.ts): the open suggestions the
// nightly scan stored for the investing capability, added up once. Shown as the Investing
// headline and folded into Home's money found.

export async function loadInvestingLeak(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<Leak> {
  const rows = await scopedFor(userId, client).suggestions.findMany({
    where: { capability: "investing", status: { in: ["waiting", "selected"] } },
    select: { topic: true, worthCents: true, worthKind: true },
  });
  return investingLeak(rows);
}
