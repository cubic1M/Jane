import { MAX_DROP_FROM_REACTION } from "@/config/practice-opportunities";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DEFAULT_SCAN_PREFERENCES, type ScanPreferences } from "@/planning/practice-opportunities";

// What the practice scan reads of the person's preferences (Phase AW, Stage A). The stored
// settings are session B1's PracticePreferences; until they are on main this is the stand-in:
// the defaults, with the drop the person said they could take read from their investor
// profile's "If your investments fell 20% in a month" answer. When PracticePreferences lands,
// read it here (stated fields win over these fallbacks) and nothing else changes.

export async function scanPreferences(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<ScanPreferences> {
  const profile = await scopedFor(userId, client).investorProfiles.findFirst({
    select: { dropReaction: true },
  });
  const fromProfile = profile?.dropReaction
    ? (MAX_DROP_FROM_REACTION[profile.dropReaction] ?? null)
    : null;
  return { ...DEFAULT_SCAN_PREFERENCES, maxDropShare: fromProfile };
}
