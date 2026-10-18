"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { AnswerError, answerCompany, markSelfCancelled, runQueuedFor } from "@/lib/agent/run";
import { requireUser } from "@/lib/session";

export type AnswerState = { ok: boolean; message: string } | null;

// The person answers a company's question; Jane sends it on.
export async function answer(_previous: AnswerState, formData: FormData): Promise<AnswerState> {
  const user = await requireUser();
  const actionId = String(formData.get("actionId") ?? "");
  try {
    await answerCompany(user.id, actionId, String(formData.get("answer") ?? ""));
  } catch (error) {
    if (error instanceof AnswerError) return { ok: false, message: error.message };
    throw error;
  }
  // In development the simulated company answers straight away.
  after(() => runQueuedFor([actionId]));
  revalidatePath("/actions");
  return { ok: true, message: "Sent. Jane will tell you what they say." };
}

// The person cancelled on the company's own page.
export async function cancelled(_previous: AnswerState, formData: FormData): Promise<AnswerState> {
  const user = await requireUser();
  try {
    await markSelfCancelled(user.id, String(formData.get("actionId") ?? ""));
  } catch (error) {
    if (error instanceof AnswerError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/actions");
  return { ok: true, message: "Thanks. Jane will watch for the next charge to make sure." };
}
