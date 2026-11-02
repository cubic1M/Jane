"use server";

import { revalidatePath } from "next/cache";
import { closeMistake, MistakeError } from "@/lib/act-mistakes";
import { requireAdmin } from "@/lib/session";

// A person closes a reported mistake, saying what was done (docs/mistakes.md).
export async function closeReported(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").slice(0, 100);
  if (!id) return;
  try {
    await closeMistake(id, String(formData.get("resolution") ?? ""));
  } catch (error) {
    if (!(error instanceof MistakeError)) throw error;
  }
  revalidatePath("/admin/mistakes");
}
