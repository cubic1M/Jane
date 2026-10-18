"use server";

import { revalidatePath } from "next/cache";
import type { ActionStatus } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { ACTION_STATUSES, ConciergeError, changeActionStatus } from "@/lib/concierge";
import { db } from "@/lib/db";
import { draftMessage, type Draft } from "@/lib/drafts";
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

export type DraftState =
  { ok: true; draft: Draft; byClaude: boolean } | { ok: false; message: string } | null;

// Drafts a message to the merchant for this action (src/lib/drafts.ts).
export async function draftForAction(
  _previous: DraftState,
  formData: FormData,
): Promise<DraftState> {
  const admin = await requireAdmin();
  const action = await db.action.findUnique({
    where: { id: String(formData.get("actionId") ?? "") },
    select: {
      id: true,
      userId: true,
      type: true,
      decision: { select: { finding: { select: { type: true, evidence: true } } } },
    },
  });
  if (!action) return { ok: false, message: "That action doesn't exist." };

  const result = await draftMessage(action.type, action.decision.finding);
  if (!result)
    return { ok: false, message: "There's no message to draft for this kind of action." };
  await logAudit(
    { type: "admin", id: admin.id },
    "admin_drafted_message",
    { type: "action", id: action.id },
    { user_id: action.userId, source: result.kind },
  );
  return { ok: true, draft: result.draft, byClaude: result.kind === "llm" };
}
