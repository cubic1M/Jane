import { AGENT_CALL_TYPES } from "@/config/agent";

// A step only the person can do on something Jane's agent is working on (spec step 83), the
// same states the actions page shows a form or link for: a company's question the agent
// couldn't answer, an offer made on a call, a company that only cancels from the person's
// own page, and a switch waiting for the person to sign up. Pure.

export const AGENT_STEPS = ["question", "offer", "self_cancel", "switch"] as const;
export type AgentStep = (typeof AGENT_STEPS)[number];

export function stepOf(action: {
  status: string;
  agentState: string | null;
  type: string;
  selfServiceUrl: string | null;
}): AgentStep | null {
  if (action.status !== "waiting_on_user") return null;
  if (action.agentState === "waiting_reply") return "question";
  if (action.agentState === "confirming") {
    if ((AGENT_CALL_TYPES as readonly string[]).includes(action.type)) return "offer";
    if (action.type === "cancel_subscription" && action.selfServiceUrl) return "self_cancel";
  }
  if (action.agentState === "switching" && action.selfServiceUrl) return "switch";
  return null;
}

// Only a web page on https goes in a link; anything else stays on the actions page.
export const safeLink = (url: string | null | undefined): string | null =>
  url && /^https:\/\/[^\s]+$/i.test(url) ? url : null;
