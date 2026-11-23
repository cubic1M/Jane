"use server";

import { revalidatePath } from "next/cache";
import { markStuck, type StuckOutcome } from "@/lib/connectors/stuck";
import { requireAdmin } from "@/lib/session";

const OUTCOMES: readonly StuckOutcome[] = ["succeeded", "failed"];

// An action stuck in `running`, marked with what the team found at the partner. Admin-only, behind
// the admin two-factor (requireAdmin); markStuck writes audit_log.
export async function markStuckAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("actionId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (/^[a-z0-9]{1,40}$/i.test(id) && (OUTCOMES as readonly string[]).includes(outcome)) {
    await markStuck(id, outcome as StuckOutcome, admin.id);
  }
  revalidatePath("/admin/connectors");
}
