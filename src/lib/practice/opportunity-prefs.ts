import { MAX_DROP_FROM_REACTION } from "@/config/practice-opportunities";
import type { Appetite } from "@/config/practice-preferences";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { ScanPreferences } from "@/planning/practice-opportunities";
import { avoidedTickers } from "@/planning/practice-profile";
import { loadPreferences } from "./preferences";

// What the practice scan reads of the person's preferences (Phase AW, Stage A): their
// PracticePreferences (./preferences.ts) in the scan's terms. The drop they can live with falls
// back to their investor profile's "If your investments fell 20% in a month" answer when they
// haven't said one in the practice settings.

const APPETITE: Readonly<Record<Appetite, ScanPreferences["appetite"]>> = {
  off: "none",
  cautious: "low",
  normal: "normal",
  adventurous: "high",
};

export async function scanPreferences(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient; now?: Date } = {},
): Promise<ScanPreferences> {
  const prefs = await loadPreferences(userId, { client });
  let maxDropShare = prefs.maxDropPercent === null ? null : prefs.maxDropPercent / 100;
  if (maxDropShare === null) {
    const profile = await scopedFor(userId, client).investorProfiles.findFirst({
      select: { dropReaction: true },
    });
    maxDropShare = profile?.dropReaction
      ? (MAX_DROP_FROM_REACTION[profile.dropReaction] ?? null)
      : null;
  }
  return {
    maxDropShare,
    goalDate: prefs.goalDate,
    appetite: APPETITE[prefs.appetite],
    excludedTickers: avoidedTickers(prefs.avoid),
    taxSensitive: prefs.harvestLosses,
    cashBufferCents: prefs.cashBufferCents,
    mode: prefs.mode,
  };
}
