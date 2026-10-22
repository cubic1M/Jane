import type { PrismaClient } from "@/generated/prisma/client";
import { CARD_SELECT, buildCard } from "@/lib/cards";
import { scopedFor } from "@/lib/db-scoped";
import { whyReply } from "./explain-replies";
import type { Reply } from "./replies";
import { findingFingerprint } from "./snapshot";
import { shortName } from "./sources/findings";

// "Why?" and "tell me more" right after a finding was talked about, typed instead of tapped:
// the same answer as the Why? button (the evidence in the person's own charges and what
// changes if they say yes), in words, with the finding's Yes and No under it. Null when the
// finding is gone or already answered.
export async function whyFindingReply(
  userId: string,
  findingId: string,
  { client }: { client: PrismaClient },
): Promise<Reply | null> {
  const finding = await scopedFor(userId, client).findings.findFirst({
    where: { id: findingId },
    select: {
      ...CARD_SELECT,
      status: true,
      id: true,
      type: true,
      evidence: true,
      annualSavingsCents: true,
    },
  });
  if (!finding || (finding.status !== "new" && finding.status !== "shown")) return null;
  const card = buildCard(finding);
  const reply = whyReply(card, []);
  return {
    ...reply,
    actions: [
      { id: "finding.yes", label: `Yes: ${shortName(finding.title)}`, kind: "primary" },
      { id: "finding.no", label: "No", kind: "secondary" },
    ],
    refs: {
      findingId,
      fingerprint: findingFingerprint(finding),
      topic: { kind: "about", findingId, target: card.title },
    },
  };
}
