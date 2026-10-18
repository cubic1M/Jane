"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { decrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { handleInboundText } from "@/lib/messaging/inbound";
import { messagingMode } from "@/lib/messaging/provider";
import {
  TextError,
  confirmVerification,
  removeTextNumber,
  saveTextPrefs,
  startVerification,
} from "@/lib/messaging/texts";
import { requireUser } from "@/lib/session";

// Texts on /settings (spec step 78): the number with consent, the code, what gets texted,
// and, outside production with no Sendblue keys, a simulated phone to answer from.

export type TextsState = { ok: boolean; message: string } | null;

async function attempt(run: () => Promise<string>): Promise<TextsState> {
  try {
    const message = await run();
    revalidatePath("/settings");
    revalidatePath("/settings/texts");
    return { ok: true, message };
  } catch (error) {
    if (error instanceof TextError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function sendTextCode(_previous: TextsState, formData: FormData): Promise<TextsState> {
  const user = await requireUser();
  return attempt(async () => {
    const { phone } = await startVerification(user.id, {
      phone: String(formData.get("phone") ?? ""),
      consent: formData.get("consent") === "on",
    });
    return `We texted a code to ${phone}. Enter it below.`;
  });
}

export async function confirmTextCode(
  _previous: TextsState,
  formData: FormData,
): Promise<TextsState> {
  const user = await requireUser();
  return attempt(async () => {
    await confirmVerification(user.id, String(formData.get("code") ?? ""));
    return "Your number is verified. Texts are on.";
  });
}

export async function saveTextSettings(
  _previous: TextsState,
  formData: FormData,
): Promise<TextsState> {
  const user = await requireUser();
  return attempt(async () => {
    const enabled = formData.get("enabled") === "on";
    await saveTextPrefs(user.id, {
      enabled,
      alerts: formData.get("alerts") === "on",
      weeklyPlan: formData.get("weeklyPlan") === "on",
      needsYou: formData.get("needsYou") === "on",
    });
    return enabled ? "Saved." : "Saved. Jane won't text you.";
  });
}

export async function forgetTextNumber(): Promise<TextsState> {
  const user = await requireUser();
  return attempt(async () => {
    await removeTextNumber(user.id);
    return "Your number is removed. Jane won't text you.";
  });
}

// The simulated phone: a reply as if the person texted it from their own number. Only
// when texts are simulated (outside production, no Sendblue keys).
export async function simulateTextReply(
  _previous: TextsState,
  formData: FormData,
): Promise<TextsState> {
  const user = await requireUser();
  if (messagingMode() !== "simulated") return { ok: false, message: "Not available." };
  const setting = await scopedFor(user.id).textSettings.findFirst({
    select: { phoneEncrypted: true, verifiedAt: true },
  });
  if (!setting?.verifiedAt) return { ok: false, message: "Verify your number first." };
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { ok: false, message: "Type a reply." };
  const result = await handleInboundText({
    content,
    is_outbound: false,
    number: decrypt(setting.phoneEncrypted),
    message_handle: `sim-in-${randomBytes(12).toString("hex")}`,
    group_id: "",
  });
  revalidatePath("/settings/texts");
  return { ok: true, message: `Sent (read as: ${result}).` };
}
