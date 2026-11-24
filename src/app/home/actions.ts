"use server";

import { revalidatePath } from "next/cache";
import { closeBooksNotice } from "@/lib/books-notice";
import { dismissChecklist } from "@/lib/checklist";
import { requireUser } from "@/lib/session";

export async function hideChecklist(): Promise<void> {
  const user = await requireUser();
  await dismissChecklist(user.id);
  revalidatePath("/home");
}

// Closes the "some figures rely on data I'm still checking" box until the problems it names change.
export async function closeBooksNote(key: string): Promise<void> {
  const user = await requireUser();
  await closeBooksNotice(user.id, key);
  revalidatePath("/home");
}
