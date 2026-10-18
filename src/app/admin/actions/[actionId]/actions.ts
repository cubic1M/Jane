"use server";

import { revalidatePath } from "next/cache";
import type { ActionStatus } from "@/generated/prisma/client";
import { ACTION_STATUSES, ConciergeError, changeActionStatus } from "@/lib/concierge";
import { requireAdmin } from "@/lib/session";

export type FormState = { ok: boolean; message: string } | null;

const text = (value: FormDataEntryValue | null) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
};

export async function updateAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const actionId = String(formData.get("actionId") ?? "");
  const status = formData.get("status");
  if (typeof status !== "string" || !(ACTION_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: "Pick a status." };
  }
  const minutes = text(formData.get("minutesSpent"));

  try {
    await changeActionStatus(admin, actionId, {
      status: status as ActionStatus,
      assignee: text(formData.get("assignee")),
      notes: text(formData.get("notes")),
      userTodo: text(formData.get("userTodo")),
      failureReason: text(formData.get("failureReason")),
      minutesSpent: minutes === null ? null : Number(minutes),
    });
  } catch (error) {
    if (error instanceof ConciergeError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/admin/actions/${actionId}`);
  return { ok: true, message: "Saved. The person has been emailed if the status changed." };
}
