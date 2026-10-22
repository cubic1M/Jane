import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { demoDisasterFeed } from "./demo";
import type { DisasterFeed } from "./types";

// Which disaster feed a person's relief is read from (spec step 270): the stand-in's sample
// declarations for people whose data is all the demo bank's (the same test as demo advice
// mode); nobody else until a real feed is connected (then add it here), so no one with real
// accounts is ever told about a sample disaster.
export async function disasterFeedFor(
  userId: string,
  { client }: { client?: PrismaClient } = {},
): Promise<DisasterFeed | null> {
  return (await adviceMode(userId, { client })) ? demoDisasterFeed : null;
}

export type { DisasterFeed } from "./types";
