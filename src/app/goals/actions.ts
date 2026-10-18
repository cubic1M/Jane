"use server";

import { revalidatePath } from "next/cache";
import { GoalError, addGoal, deleteGoal, updateGoal, type GoalForm } from "@/lib/goals";
import { requireUser } from "@/lib/session";

export type GoalState = { ok: boolean; message: string } | null;

const formOf = (formData: FormData): GoalForm => ({
  name: String(formData.get("name") ?? ""),
  target: String(formData.get("target") ?? ""),
  targetDate: String(formData.get("targetDate") ?? ""),
  accountId: String(formData.get("accountId") ?? ""),
  saved: String(formData.get("saved") ?? ""),
});

export async function saveGoal(_previous: GoalState, formData: FormData): Promise<GoalState> {
  const user = await requireUser();
  const goalId = String(formData.get("goalId") ?? "");
  try {
    if (goalId) await updateGoal(user.id, goalId, formOf(formData));
    else await addGoal(user.id, formOf(formData));
  } catch (error) {
    if (error instanceof GoalError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/goals");
  revalidatePath("/home");
  return { ok: true, message: "Saved." };
}

export async function removeGoal(formData: FormData): Promise<void> {
  const user = await requireUser();
  await deleteGoal(user.id, String(formData.get("goalId") ?? ""));
  revalidatePath("/goals");
  revalidatePath("/home");
}
