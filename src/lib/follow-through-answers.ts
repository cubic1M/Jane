import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { markDiyDone } from "@/lib/decisions";
import {
  FINDING_OUTCOME_PREFIX,
  markSuggestionDone,
  OutcomeError,
  recordAnswer,
} from "@/lib/outcomes";
import { answerSuggestion, SuggestionError } from "@/lib/suggestions";

// The person's answer to a follow-up: "I did it" or "Not for me". Either way the nudges stop. A
// finding card goes through its decision, so the card and the record agree.

type Options = { client?: PrismaClient; now?: Date };

const findingIdOf = (key: string) =>
  key.startsWith(FINDING_OUTCOME_PREFIX) ? key.slice(FINDING_OUTCOME_PREFIX.length) : null;

export async function markFollowUpDone(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const findingId = findingIdOf(key);
  if (!findingId) {
    await markSuggestionDone(userId, key, { client, now });
    return;
  }
  const decision = await scopedFor(userId, client).decisions.findFirst({
    where: { findingId, choice: "diy", undoneAt: null, diyDoneAt: null },
    select: { id: true },
  });
  // markDiyDone records it too. A retry after a failed fix has its decision marked already.
  if (decision) await markDiyDone(userId, decision.id, { client, now });
  else await markSuggestionDone(userId, key, { client, now });
}

export async function declineFollowUp(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const findingId = findingIdOf(key);
  if (!findingId) {
    await answerSuggestion(userId, key, "no", { client, now }).catch(async (error) => {
      // No suggestion row left (it was scanned away): the record still takes the answer.
      if (!(error instanceof SuggestionError)) throw error;
      await recordAnswer(userId, key, "no", { client, now });
    });
    return;
  }
  await recordAnswer(userId, key, "no", { client, now });
  await scopedFor(userId, client).findings.updateMany({
    where: { id: findingId, status: { in: ["in_progress", "done"] } },
    data: { status: "declined" },
  });
}

export { OutcomeError };
