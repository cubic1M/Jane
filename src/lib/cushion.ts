import type { PrismaClient } from "@/generated/prisma/client";
import { cushionOf, type Cushion } from "@/detectors/money";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import { buildProfile } from "@/profile/build";

// The cushion card's own figure and working (cushionOf), over the rows and profile the card was
// made from (src/lib/suggestions.ts detectFor), for the goal page it opens.
export async function loadCushion(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ cushion: Cushion | null; asOf: string }> {
  const input = await loadProfileInput(userId, { client, now });
  return { cushion: cushionOf({ profile: buildProfile(input), data: input }), asOf: input.today };
}
