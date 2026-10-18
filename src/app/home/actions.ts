"use server";

import { revalidatePath } from "next/cache";
import { dismissChecklist } from "@/lib/checklist";
import { requireUser } from "@/lib/session";

export async function hideChecklist(): Promise<void> {
  const user = await requireUser();
  await dismissChecklist(user.id);
  revalidatePath("/home");
}
