"use server";

import { redirect } from "next/navigation";
import { ShortTermError, startLadder } from "@/lib/investments/short-term";
import { requireUser } from "@/lib/session";

// The short-term money page's button (spec step 234). A ladder is the person's tap.

export async function buildLadder(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await startLadder(user.id, String(formData.get("key") ?? ""));
  } catch (error) {
    if (!(error instanceof ShortTermError)) throw error;
    redirect("/investments/short-term?done=changed");
  }
  redirect("/investments/short-term?done=started");
}
