"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TIMEZONES } from "@/config/digest";
import { runDetection } from "@/detection/engine";
import { deleteAllData } from "@/lib/account-deletion";
import { db } from "@/lib/db";
import { PlaidRequestError } from "@/lib/plaid/client";
import { ItemMissingError, removePlaidItem } from "@/lib/plaid/remove";
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

// Disconnects one linked bank and everything read from it, then refreshes findings.
export async function disconnectBank(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  try {
    await removePlaidItem(user.id, String(formData.get("itemId") ?? ""), "user_disconnected");
  } catch (error) {
    if (error instanceof ItemMissingError) return { ok: false, message: error.message };
    if (error instanceof PlaidRequestError) {
      return { ok: false, message: "We couldn't reach your bank's connection. Try again." };
    }
    throw error;
  }
  await runDetection(user.id);
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected. We've removed that bank's data." };
}

// Deletes everything we hold about the person, once they type DELETE.
export async function deleteMyData(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  if (formData.get("confirm") !== "DELETE") {
    return { ok: false, message: "Type DELETE in capitals to confirm." };
  }
  try {
    await deleteAllData(user.id);
  } catch (error) {
    if (error instanceof PlaidRequestError) {
      return {
        ok: false,
        message: "We couldn't disconnect your banks. Nothing was deleted; try again.",
      };
    }
    throw error;
  }
  redirect("/goodbye");
}
