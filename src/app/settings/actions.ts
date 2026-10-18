"use server";

import { revalidatePath } from "next/cache";
import { TIMEZONES } from "@/config/digest";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export type SettingsState = { ok: boolean; message: string } | null;

// The signed-in person's own email preferences.
export async function saveEmailPreferences(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const timezone = String(formData.get("timezone") ?? "");
  if (!TIMEZONES.some((t) => t.id === timezone)) {
    return { ok: false, message: "Pick a timezone from the list." };
  }
  await db.user.update({
    where: { id: user.id },
    data: { digestEnabled: formData.get("digest") === "on", timezone },
  });
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}
