"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { verifyAdminCode } from "@/lib/mfa";
import { getCurrentUser } from "@/lib/session";

export type MfaState = { message: string } | null;

const MESSAGES = {
  wrong_code: "That code didn't match. Check your authenticator app and try again.",
  too_many_attempts: "Too many tries. Wait ten minutes and try again.",
  not_enrolled: "Set up two-factor first.",
};

// Only paths inside /admin, so the form can't be used to redirect anywhere else.
function safeNext(value: FormDataEntryValue | null): string {
  return typeof value === "string" && /^\/admin(\/[\w/-]*)?$/.test(value) ? value : "/admin/queue";
}

export async function submitCode(_previous: MfaState, formData: FormData): Promise<MfaState> {
  const user = await getCurrentUser();
  const token = sessionTokenFrom(await cookies());
  if (user?.role !== "admin" || !token) notFound();

  const result = await verifyAdminCode(user.id, token, String(formData.get("code") ?? ""));
  if (result !== "ok") return { message: MESSAGES[result] };
  redirect(safeNext(formData.get("next")));
}
