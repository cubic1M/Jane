"use server";

import { after } from "next/server";
import { runAgentNow } from "@/lib/agent/run";
import { isPickError, pickOffered } from "@/lib/jane-agent/actions/options";
import { requireUser } from "@/lib/session";

// A pick on the comparison cards of an area page (src/components/comparison-cards.tsx). The
// screen shows the choice at once; this queues it behind, through the same lane pickers as the
// chat's option.pick: each prices the options again and refuses a stale or made-up one, so
// nothing the screen sends is trusted. Nothing is bought, applied for or moved.

export type PickTarget = { kind: "insurance" | "loan"; topic: string; policyId: string | null };
export type PickResult = { ok: true; note: string } | { ok: false; error: string };

export async function pickCompared(target: PickTarget, optionId: string): Promise<PickResult> {
  const user = await requireUser();
  const kind = target?.kind;
  if (
    (kind !== "insurance" && kind !== "loan") ||
    typeof target.topic !== "string" ||
    target.topic.length > 120 ||
    typeof optionId !== "string" ||
    optionId.length === 0 ||
    optionId.length > 80
  ) {
    return { ok: false, error: "That option isn't on this card." };
  }
  const policyId = typeof target.policyId === "string" && target.policyId ? target.policyId : null;
  try {
    const { note, agentJobId } = await pickOffered(
      user.id,
      { kind, topic: target.topic, ...(policyId ? { policyId } : {}) },
      optionId,
    );
    if (agentJobId) after(() => runAgentNow([agentJobId]));
    // No revalidate: the page keeps the cards with the choice on them, and every page that
    // lists actions is dynamic, so it shows the pick when opened.
    return { ok: true, note };
  } catch (error) {
    if (isPickError(error)) return { ok: false, error: error.message };
    throw error;
  }
}
