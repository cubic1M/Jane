"use server";

import { redirect } from "next/navigation";
import { applyValues, savePrefs, ValuesError } from "@/lib/investments/values";
import { requireUser } from "@/lib/session";

// The values page's buttons (spec step 236). Saving the list moves nothing; switching funds
// is the person's own tap.

export async function saveValues(formData: FormData): Promise<void> {
  const user = await requireUser();
  await savePrefs(user.id, {
    excludes: formData.getAll("excludes").map(String),
    themes: formData.getAll("themes").map(String),
  });
  redirect("/investments/values?done=saved");
}

export async function switchFunds(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await applyValues(user.id, String(formData.get("key") ?? ""));
  } catch (error) {
    if (!(error instanceof ValuesError)) throw error;
    redirect("/investments/values?done=changed");
  }
  redirect("/investments/values?done=switched");
}
