import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { conciergeMode } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DecisionError, recordDecision } from "@/lib/decisions";
import type { Options } from "./action";

// A company charged after a cancellation the person approved: Jane asks for that money
// back on its own (logged as an automatic follow-up of the earlier yes).
export async function refundChargesAfterCancel(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<string[]> {
  // Read-only mode: for a real account the finding waits for the person, with its kit.
  if (!(await conciergeMode(userId, { client }))) return [];
  const db = scopedFor(userId, client);
  const findings = await db.findings.findMany({
    where: { type: "charge_after_cancel", status: { in: ["new", "shown"] } },
    select: CARD_SELECT,
  });
  const approved: string[] = [];
  for (const finding of findings) {
    try {
      const { decisionId } = await recordDecision(
        userId,
        {
          findingId: finding.id,
          choice: "yes",
          cardHash: cardHash(buildCard(finding)),
          source: "auto",
          ruleKey: "charge_after_cancel",
        },
        { client },
      );
      approved.push(decisionId);
    } catch (error) {
      if (!(error instanceof DecisionError)) throw error;
    }
  }
  return approved;
}
