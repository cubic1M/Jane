import { MAX_DROP_FROM_REACTION } from "@/config/practice-opportunities";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { ScanPreferences } from "@/planning/practice-opportunities";
import { scanPreferencesFor } from "@/planning/practice-profile";
import { loadPreferences } from "./preferences";

// What the practice scan reads of the person's preferences (Phase AW, Stage A): their
// PracticePreferences (./preferences.ts) in the scan's terms. The drop they can live with falls
// back to their investor profile's "If your investments fell 20% in a month" answer when they
// haven't said one in the practice settings.

export async function scanPreferences(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient; now?: Date } = {},
): Promise<ScanPreferences> {
  const prefs = await loadPreferences(userId, { client });
  if (prefs.maxDropPercent !== null) return scanPreferencesFor(prefs);
  const profile = await scopedFor(userId, client).investorProfiles.findFirst({
    select: { dropReaction: true },
  });
  const fallback = profile?.dropReaction
    ? (MAX_DROP_FROM_REACTION[profile.dropReaction] ?? null)
    : null;
  return scanPreferencesFor(prefs, fallback);
}
