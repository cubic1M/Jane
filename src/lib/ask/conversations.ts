import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Earlier Ask Jane conversations (spec step 23), always through scopedFor: a person only ever
// sees or deletes their own. Nothing new is saved: questions go to the one chat now
// (docs/feature-audit.md, cluster 5); the conversations stay readable on /ask, in Download my
// data, and are deleted with the account.

type Options = { client?: PrismaClient };

export async function deleteConversation(
  userId: string,
  conversationId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).askConversations.deleteMany({
    where: { id: conversationId },
  });
  return count > 0;
}
