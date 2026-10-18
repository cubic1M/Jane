"use server";

import { revalidatePath } from "next/cache";
import type { ActionStatus } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { ACTION_STATUSES, ConciergeError, changeActionStatus, teamMembers } from "@/lib/concierge";
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
  const assignee = text(formData.get("assignee"));
  if (assignee && !(await teamMembers()).includes(assignee)) {
    return { ok: false, message: "Assign it to someone on the team." };
  }

  try {
    await changeActionStatus(admin, actionId, {
      status: status as ActionStatus,
      assignee,
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

export type ConversionState = { ok: boolean; message: string } | null;

// Records that a referral on this action turned into revenue.
export async function recordConversion(
  _previous: ConversionState,
  formData: FormData,
): Promise<ConversionState> {
  const admin = await requireAdmin();
  const action = await db.action.findUnique({
    where: { id: String(formData.get("actionId") ?? "") },
    select: { id: true, userId: true, decision: { select: { cardSnapshot: true } } },
  });
  const key = (action?.decision.cardSnapshot as { referralPartner?: { key?: unknown } } | null)
    ?.referralPartner?.key;
  if (!action || typeof key !== "string") {
    return { ok: false, message: "This action didn't use a referral partner." };
  }
  const partner = await db.referralPartner.findUnique({ where: { key }, select: { id: true } });
  if (!partner) return { ok: false, message: "That partner no longer exists." };
  const dollars = Number(String(formData.get("amount") ?? "").replace(/[$,]/g, ""));
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { ok: false, message: "Enter the amount the partner paid, like 40." };
  }
  const conversion = await db.referralConversion.create({
    data: {
      partnerId: partner.id,
      userId: action.userId,
      actionId: action.id,
      amountCents: Math.round(dollars * 100),
    },
    select: { id: true, amountCents: true },
  });
  await logAudit(
    { type: "admin", id: admin.id },
    "referral_conversion_recorded",
    { type: "action", id: action.id },
    { partner: key, amount_cents: conversion.amountCents, user_id: action.userId },
  );
  revalidatePath(`/admin/actions/${action.id}`);
  return { ok: true, message: "Recorded." };
}
