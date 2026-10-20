import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The demo bank's home and car (spec step 67), so its sample person's net worth counts what
// the mortgage and the car loan are against instead of only the debts. Added once, after the
// first sync has saved the loans; a person who already has a home or a car on file, or
// who removed these, keeps what they have.
export const DEMO_ASSETS = [
  { kind: "home", name: "Demo home", valueCents: 38_000_000, loanSubtype: "mortgage" },
  { kind: "vehicle", name: "Demo car", valueCents: 2_450_000, loanSubtype: "auto" },
] as const;

export async function ensureDemoAssets(
  userId: string,
  itemId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  if ((await db.ownedAssets.count()) > 0) return 0;
  const loans = await db.accounts.findMany({
    where: { itemId, type: "loan" },
    select: { id: true, subtype: true },
  });
  const valuedOn = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const { count } = await db.ownedAssets.createMany({
    data: DEMO_ASSETS.map((asset) => ({
      userId,
      kind: asset.kind,
      name: asset.name,
      valueCents: asset.valueCents,
      valuedOn,
      loanAccountId: loans.find((l) => l.subtype === asset.loanSubtype)?.id ?? null,
    })),
  });
  return count;
}
