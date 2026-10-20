"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addPastEmployer,
  answerOldPlan,
  OldAccountsError,
  startRollover,
} from "@/lib/investments/old-accounts";
import { requireUser } from "@/lib/session";

// The old accounts page's buttons (spec step 211). A rollover is always the person's tap.

const BASE = "/investments/old-accounts";

export async function answer(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await answerOldPlan(user.id, String(formData.get("id") ?? ""), formData.get("had") === "yes");
  } catch (error) {
    if (!(error instanceof OldAccountsError)) throw error;
  }
  redirect(BASE);
}

export async function rollOver(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await startRollover(user.id, String(formData.get("id") ?? ""));
  } catch (error) {
    if (!(error instanceof OldAccountsError)) throw error;
    redirect(`${BASE}?done=changed`);
  }
  revalidatePath("/investments");
  redirect(`${BASE}?done=started`);
}

export async function addEmployer(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await addPastEmployer(user.id, String(formData.get("employer") ?? ""));
  } catch (error) {
    if (!(error instanceof OldAccountsError)) throw error;
  }
  redirect(BASE);
}
