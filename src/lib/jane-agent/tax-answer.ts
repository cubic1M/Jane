import type { PrismaClient } from "@/generated/prisma/client";
import { loadWorkingProfile } from "@/lib/tax-profile";
import type { Reply } from "./replies";
import type { TaxIntent } from "./tax-intents";
import { taxReply } from "./tax-replies";

// Answers a typed tax question by rules (spec steps 118–127), with the same loaders as
// /taxes, scoped to the person.
export async function answerTaxIntent(
  userId: string,
  intent: TaxIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const { view, autopilot } = await loadWorkingProfile(userId, { client, now });
  return taxReply(intent, view, autopilot);
}
