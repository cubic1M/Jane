import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import { buildProfile } from "@/profile/build";
import { computeNeeds } from "./calculators";
import { needInputFromProfile } from "./from-profile";
import type { Need } from "./types";

// The needs for one person, from the same profile the detectors read (spec step 278), so the
// chat, the page and the nightly scan all give the same number for the same person. Loads the
// profile, so it is called when a need is asked about, not on every message.

export async function withNeeds<T extends { needs?: Need[] | null }>(
  userId: string,
  snapshot: T,
  options: { client?: PrismaClient; now?: Date } = {},
): Promise<T> {
  if (snapshot.needs !== undefined) return snapshot;
  return { ...snapshot, needs: await loadNeeds(userId, options) };
}

export async function loadNeeds(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<Need[] | null> {
  const data = await loadProfileInput(userId, { client, now });
  const input = needInputFromProfile(buildProfile(data), data);
  return input ? computeNeeds(input) : null;
}
