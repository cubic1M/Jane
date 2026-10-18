"use server";

import { after } from "next/server";
import { runQueuedFor } from "@/lib/agent/run";
import { scopedFor } from "@/lib/db-scoped";
import { LinkError, takeBackLink, useLink } from "@/lib/plan-links";

export type GoState = { ok: boolean; message: string } | null;

// The one tap from an email or notification. The token in the form is the credential:
// no sign-in, and it only covers the items it was made for.
export async function goAhead(_previous: GoState, formData: FormData): Promise<GoState> {
  try {
    const { approved, skipped, userId } = await useLink(String(formData.get("token") ?? ""));
    // The agent waits out the hour to take it back, then starts (the daily job, or now if due).
    const working = await scopedFor(userId).actions.findMany({
      where: { agentState: "working" },
      select: { id: true },
    });
    after(() => runQueuedFor(working.map((a) => a.id)));
    return {
      ok: true,
      message: `Done: Jane is on ${approved} ${approved === 1 ? "thing" : "things"}.${
        skipped > 0 ? ` ${skipped} had changed, so they're left on your plan.` : ""
      } You can take it back for the next hour from this same link.`,
    };
  } catch (error) {
    if (error instanceof LinkError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function takeBack(_previous: GoState, formData: FormData): Promise<GoState> {
  try {
    const undone = await takeBackLink(String(formData.get("token") ?? ""));
    return {
      ok: true,
      message: `Taken back: ${undone} ${undone === 1 ? "thing is" : "things are"} on your plan again.`,
    };
  } catch (error) {
    if (error instanceof LinkError) return { ok: false, message: error.message };
    throw error;
  }
}
