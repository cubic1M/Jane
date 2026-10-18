"use server";

import { cookies } from "next/headers";
import { sessionTokenFrom } from "@/lib/admin-gate";
import { requireUser } from "@/lib/session";
import { signOutOtherSessions, signOutSession } from "@/lib/user-sessions";

// Devices and sessions (spec step 73). Sessions are named by their row id; this session
// is told apart by its cookie, read here on the server only. No revalidatePath: the list
// hides what was signed out itself, so the confirmation stays on screen.

export type SessionsState = { ok: boolean; message: string } | null;

export async function signOutDevice(
  _previous: SessionsState,
  formData: FormData,
): Promise<SessionsState> {
  const user = await requireUser();
  const token = sessionTokenFrom(await cookies());
  const result = await signOutSession(user.id, String(formData.get("sessionId") ?? ""), token);
  return result === "ok"
    ? { ok: true, message: "Signed out of that device." }
    : { ok: false, message: "That session has already ended." };
}

export async function signOutOthers(): Promise<SessionsState> {
  const user = await requireUser();
  const count = await signOutOtherSessions(user.id, sessionTokenFrom(await cookies()));
  return {
    ok: true,
    message:
      count === 0
        ? "You're not signed in anywhere else."
        : `Signed out of ${count} other ${count === 1 ? "device" : "devices"}.`,
  };
}
