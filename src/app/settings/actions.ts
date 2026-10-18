"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ALERT_TYPES } from "@/config/alerts";
import { isStateCode } from "@/config/referrals";
import { TIMEZONES } from "@/config/digest";
import { runDetection } from "@/detection/engine";
import { deleteAllData } from "@/lib/account-deletion";
import { createCalendarToken, turnOffCalendar } from "@/lib/calendar";
import { appBase } from "@/lib/digest/links";
import { alertPrefs } from "@/lib/alerts";
import { db } from "@/lib/db";
import { PlaidRequestError } from "@/lib/plaid/client";
import { ItemMissingError, removePlaidItem } from "@/lib/plaid/remove";
import { syncItem } from "@/lib/plaid/sync";
import { scopedFor } from "@/lib/db-scoped";
import { hit } from "@/lib/rate-limit";
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

// The person's state. Only used to decide which referral partners may be offered.
export async function saveState(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const state = String(formData.get("state") ?? "");
  if (state && !isStateCode(state)) return { ok: false, message: "Pick a state from the list." };
  await db.user.update({ where: { id: user.id }, data: { state: state || null } });
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

export type CalendarState = { ok: boolean; message: string; link?: string } | null;

// A new private calendar link; any old one stops working.
export async function createCalendarLink(): Promise<CalendarState> {
  const user = await requireUser();
  const token = await createCalendarToken(user.id);
  revalidatePath("/settings");
  return {
    ok: true,
    message: "Your calendar link (shown once; anyone with it can see these events):",
    link: `${appBase()}/api/calendar/${token}.ics`,
  };
}

export async function stopCalendar(): Promise<CalendarState> {
  const user = await requireUser();
  await turnOffCalendar(user.id);
  revalidatePath("/settings");
  return { ok: true, message: "Calendar link turned off." };
}

// Which alerts the person gets, and how. Unknown values fall back to the defaults.
export async function saveAlertPreferences(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const prefs = alertPrefs(Object.fromEntries(ALERT_TYPES.map((t) => [t, formData.get(t)])));
  await db.user.update({ where: { id: user.id }, data: { alertPrefs: prefs } });
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

// "Refresh now": reads new transactions from one linked bank right away.
export async function refreshBank(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  if (!(await hit("plaid", user.id)).ok) {
    return { ok: false, message: "You've refreshed a lot recently. Try again in a few minutes." };
  }
  const item = await scopedFor(user.id).plaidItems.findFirst({
    where: { id: String(formData.get("itemId") ?? "") },
    select: { id: true },
  });
  if (!item) return { ok: false, message: "That linked bank doesn't exist." };
  try {
    const result = await syncItem(item.id);
    revalidatePath("/settings");
    return {
      ok: true,
      message: result.added > 0 ? `Updated: ${result.added} new transactions.` : "Up to date.",
    };
  } catch (error) {
    if (error instanceof PlaidRequestError) {
      return {
        ok: false,
        message:
          error.code === "ITEM_LOGIN_REQUIRED"
            ? "Your bank needs you to sign in again. Use Reconnect on the Accounts page."
            : "We couldn't reach your bank just now. Try again later.",
      };
    }
    throw error;
  }
}
