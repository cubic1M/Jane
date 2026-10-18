"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { verifySessionCode } from "@/lib/mfa";
import { getSessionState } from "@/lib/session";
import { safeNext } from "./next-path";

export type MfaState = { message: string } | { backupCodes: string[]; next: string } | null;

const MESSAGES = {
  wrong_code: "That code didn't match. Check your authenticator app and try again.",
  too_many_attempts: "Too many tries. Wait ten minutes and try again.",
  not_enrolled: "Set up two-factor first.",
};

// Checks a code for this session. The first code that sets up two-factor shows the
// backup codes (once) before continuing.
export async function submitCode(_previous: MfaState, formData: FormData): Promise<MfaState> {
  const state = await getSessionState();
  const token = sessionTokenFrom(await cookies());
  if (!state || !token) notFound();

  const { result, backupCodes } = await verifySessionCode(
    state.user.id,
    token,
    String(formData.get("code") ?? ""),
  );
  if (result !== "ok") return { message: MESSAGES[result] };
  const next = safeNext(formData.get("next"), state.user.role);
  if (backupCodes) return { backupCodes, next };
  redirect(next);
}
