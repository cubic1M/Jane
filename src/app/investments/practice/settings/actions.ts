"use server";

import { redirect } from "next/navigation";
import { adviceMode } from "@/lib/advice-mode";
import { savePreferences } from "@/lib/practice/preferences";
import { parsePreferenceForm } from "@/planning/practice-preferences";
import { requireUser } from "@/lib/session";

// The practice settings page's Save (Phase AW, Stage A): the whole form through the same check as
// the chat (applyPatch, in savePreferences), audit-logged. Practice money and demo advice only.

export async function savePracticeSettings(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!(await adviceMode(user.id))) redirect("/investments/practice");
  const saved = await savePreferences(user.id, parsePreferenceForm(formData), "page");
  if (!saved.ok) {
    redirect(`/investments/practice/settings?error=${Object.keys(saved.errors)[0]}`);
  }
  redirect(`/investments/practice/settings?done=${saved.changed.length > 0 ? "saved" : "same"}`);
}
