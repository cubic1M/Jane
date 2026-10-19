import type { CoverEvent } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { listCoverChanges, tellCoverEvent } from "@/lib/insurance/cover-changes";
import { partnerFor } from "@/lib/insurance/partner";
import { listPolicies } from "@/lib/insurance/policies";
import type { Reply } from "../replies";
import { CHANGES_LINK, EVENT_INTRO, coverActions, coverBody, coverEventRef } from "./cover-words";

// "I got married", "I bought a car" (spec step 154): Jane prepares the cover changes the
// event needs right away and asks once, in the reply.

export async function lifeChangeAnswer(
  userId: string,
  event: CoverEvent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const eventKey = await tellCoverEvent(userId, event, { client, now });
  const [changes, policies, partner] = await Promise.all([
    listCoverChanges(userId, { client, status: "prepared" }),
    listPolicies(userId, { client }),
    partnerFor(userId, { client }),
  ]);
  const mine = changes.filter((c) => c.event === event && c.eventKey === eventKey);
  if (mine.length === 0) {
    return {
      body: `${EVENT_INTRO[event]} Your insurance is up to date for it.`,
      actions: [CHANGES_LINK],
      refs: {},
    };
  }
  return {
    body: coverBody(event, mine, policies, partner !== null),
    actions: coverActions(mine, partner !== null),
    refs: { coverEvent: coverEventRef(event, eventKey) },
  };
}
