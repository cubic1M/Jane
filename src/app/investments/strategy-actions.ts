"use server";

import { redirect } from "next/navigation";
import { STRATEGY_CHOICES } from "@/config/practice-preferences";
import { savePreferences } from "@/lib/practice/preferences";
import { requireUser } from "@/lib/session";

// "Use in practice" on a strategy menu card (Phase AW, Stage A): the practice portfolio's
// strategy, saved through the same check as the settings page. Practice money only.
export async function usePracticeStrategy(formData: FormData): Promise<void> {
  const user = await requireUser();
  const strategy = String(formData.get("strategy") ?? "");
  if (Object.hasOwn(STRATEGY_CHOICES, strategy)) {
    await savePreferences(user.id, { strategy }, "page");
  }
  // Back to the same card: the investing tree opens on More strategies.
  redirect("/investments?focus=strategies:menu");
}
