"use server";

import { revalidatePath } from "next/cache";
import { EventsError, runEventOverlay, setEventsOverlay } from "@/lib/events/run";
import { markEventSeen, revertEventAction } from "@/lib/events/updates";
import { requireUser } from "@/lib/session";

// The Events box's switch (src/components/events-box.tsx): the events overlay on or off for the
// person's paper account. Switching it on runs it at once on the latest close, so an event already
// known is acted on now, in the paper account only. Simulated money only.

export type SwitchResult = { ok: true; on: boolean; trades: number } | { ok: false; error: string };

export async function setEventsAction(on: boolean): Promise<SwitchResult> {
  const user = await requireUser();
  try {
    await setEventsOverlay(user.id, on === true);
  } catch (error) {
    if (error instanceof EventsError) return { ok: false, error: error.message };
    throw error;
  }
  const trades = on === true ? (await runEventOverlay(user.id)).trades : 0;
  revalidatePath("/investments");
  return { ok: true, on: on === true, trades };
}

// The trade pop-up's buttons on one of the overlay's own trades: OK, and Revert.
export async function eventSeenAction(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  return markEventSeen(user.id, id);
}

export async function eventRevertAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const result = await revertEventAction(user.id, id);
  if (result.ok) revalidatePath("/investments");
  return result;
}
