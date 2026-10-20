"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CashError, moveCash } from "@/lib/investments/cash";
import { requireUser } from "@/lib/session";

// The cash page's buttons (spec step 162): one move of the plan, through the stand-ins.

export async function moveNow(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await moveCash(user.id, String(formData.get("key") ?? ""), String(formData.get("move") ?? ""));
  } catch (error) {
    if (!(error instanceof CashError)) throw error;
    redirect("/investments/cash?done=changed");
  }
  revalidatePath("/investments");
  redirect("/investments/cash?done=moved");
}
