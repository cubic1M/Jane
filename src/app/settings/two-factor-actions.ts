"use server";

import { revalidatePath } from "next/cache";
import { newBackupCodes, turnOffTwoFactor } from "@/lib/mfa";
import { requireUser } from "@/lib/session";

export type TwoFactorState = { ok: boolean; message: string; codes?: string[] } | null;

const MESSAGES = {
  wrong_code: "That code didn't match. Use a current code from your app, or a backup code.",
  too_many_attempts: "Too many tries. Wait ten minutes and try again.",
  not_enabled: "Two-factor isn't on.",
  admin: "Team accounts always need two-factor, so it can't be turned off.",
};

export async function turnOff(_previous: TwoFactorState, formData: FormData) {
  const user = await requireUser();
  const result = await turnOffTwoFactor(user.id, String(formData.get("code") ?? ""));
  if (result !== "ok") return { ok: false, message: MESSAGES[result] };
  revalidatePath("/settings");
  return { ok: true, message: "Two-factor is off." };
}

export async function makeBackupCodes(
  _previous: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const user = await requireUser();
  const { result, codes } = await newBackupCodes(user.id, String(formData.get("code") ?? ""));
  if (result !== "ok") return { ok: false, message: MESSAGES[result] };
  revalidatePath("/settings");
  return { ok: true, message: "New backup codes made. The old ones no longer work.", codes };
}
