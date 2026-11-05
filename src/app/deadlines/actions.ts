"use server";

import { isTrialUser } from "@/lib/trial-ids";
import { revalidatePath } from "next/cache";
import { DeadlineError, addDeadline, deleteDeadline, markDeadlineDone } from "@/lib/deadlines";
import { requireUser } from "@/lib/session";

// Hand-entered deadlines on /deadlines (spec step 71).

export type DeadlineState = { ok: boolean; message: string } | null;

// Adding keeps its message on screen: the form refreshes the list itself, so this doesn't
// revalidate /deadlines (that would reset the form's state).
export async function saveDeadline(
  _previous: DeadlineState,
  formData: FormData,
): Promise<DeadlineState> {
  const user = await requireUser();
  try {
    await addDeadline(user.id, {
      title: String(formData.get("title") ?? ""),
      dueOn: String(formData.get("dueOn") ?? ""),
      kind: String(formData.get("kind") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    if (error instanceof DeadlineError) return { ok: false, message: error.message };
    throw error;
  }
  // A temporary try is gone within a day or two, and no reminder goes to it.
  return {
    ok: true,
    message: isTrialUser(user.id) ? "Added." : "Added. Jane will remind you a few days before.",
  };
}

export async function finishDeadline(formData: FormData): Promise<void> {
  const user = await requireUser();
  await markDeadlineDone(user.id, String(formData.get("deadlineId") ?? ""));
  revalidatePath("/deadlines");
}

export async function removeDeadline(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deleteDeadline(user.id, String(formData.get("deadlineId") ?? ""));
  revalidatePath("/deadlines");
}
