import type { PrismaClient } from "@/generated/prisma/client";
import type { EvidenceRefs } from "@/lib/finding-accounts";
import { orphaned, presentFor } from "./orphans";

// The evidence gate (card-chat mismatch): a surface or a chat lookup gets its items through it,
// and an item whose named evidence is all gone is dropped. removeOrphans deletes such rows; this
// covers the moment between a removal and that cleanup, and anything it misses.
export async function withEvidence<T>(
  userId: string,
  items: readonly T[],
  refsOf: (item: T) => EvidenceRefs,
  { client }: { client: PrismaClient },
): Promise<T[]> {
  if (items.length === 0) return [];
  const refs = items.map(refsOf);
  const present = await presentFor(
    userId,
    refs.flatMap((r) => r.transactionIds),
    client,
  );
  return items.filter((_, i) => !orphaned(refs[i], present));
}
