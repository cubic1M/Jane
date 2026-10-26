"use server";

import { revalidatePath } from "next/cache";
import type { AgentInterval } from "@/config/trading-agent";
import { requireUser } from "@/lib/session";
import { AgentError, startTradingAgent, stopTradingAgent } from "@/lib/trading-agent/agent";

// The 24-hour agent's buttons on the investments page: start it with a strategy and an interval
// (it catches up on the last day at once), and stop it. Simulated money only.

export async function startAgentAction(
  policy: string,
  interval: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    await startTradingAgent(user.id, { policy, interval: interval as AgentInterval });
  } catch (error) {
    if (error instanceof AgentError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath("/investments");
  return { ok: true };
}

export async function stopAgentAction(): Promise<{ ok: true }> {
  const user = await requireUser();
  await stopTradingAgent(user.id);
  revalidatePath("/investments");
  return { ok: true };
}
