"use server";

import { after } from "next/server";
import { runQueuedFor } from "@/lib/agent/run";
import { AutopilotError, setAutopilot } from "@/lib/autopilot";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";

export type AutopilotState = { ok: boolean; message: string } | null;

// One tap: sets the level and lets Jane start on matching items at once.
export async function chooseAutopilot(
  _previous: AutopilotState,
  formData: FormData,
): Promise<AutopilotState> {
  const user = await requireUser();
  const level = formData.get("level");
  let started: number;
  try {
    started = await setAutopilot(user.id, level);
  } catch (error) {
    if (error instanceof AutopilotError) return { ok: false, message: error.message };
    throw error;
  }
  // The agent's first steps on what was just approved.
  const db = await scopedDb();
  const working = await db.actions.findMany({
    where: { agentState: "working" },
    select: { id: true },
  });
  after(() => runQueuedFor(working.map((a) => a.id)));
  // No revalidate: the chooser stays on screen with its message; the next page load
  // shows the new state.
  if (level === "ask")
    return { ok: true, message: "Got it: Jane will ask you before doing anything." };
  return {
    ok: true,
    message:
      started > 0
        ? `Autopilot is on. Jane started on ${started} ${started === 1 ? "thing" : "things"} already; see them on your plan.`
        : "Autopilot is on. Jane will handle these as they come up.",
  };
}
