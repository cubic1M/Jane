import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { checkupAll, checkupPerson } from "./checkups";
import { insuranceAutopilot } from "./autopilot";
import { reshopAll, reshopPerson } from "./shop";

// Insurance that runs itself (spec Phase X), at every autopilot level: reshops 45 days before
// renewal and on a price rise (step 104), and the coverage checkup once a year and after a
// life event (step 106). Daily for everyone, and right after a person's bank syncs.

type Options = { client?: PrismaClient; now?: Date };

export async function insuranceDaily({ client = defaultClient, now = new Date() }: Options = {}) {
  return {
    reshop: await reshopAll({ client, now }),
    checkups: await checkupAll({ client, now }),
  };
}

// After one person's sync. A problem here never fails the sync; the daily run tries again.
export async function insuranceAfterSync(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  try {
    await reshopPerson(userId, { client, now });
    // Spec step 141: a switch within Insurance's autopilot caps, when the person allowed it.
    await insuranceAutopilot(userId, { client, now });
    await checkupPerson(userId, { client, now });
  } catch (error) {
    console.error("Insurance after sync failed", { userId, error: String(error) });
  }
}
