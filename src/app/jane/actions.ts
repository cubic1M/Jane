"use server";

import { revalidatePath } from "next/cache";
import { SECTORS, type Sector } from "@/config/autopilot-sectors";
import { MistakeError, reportMistake } from "@/lib/act-mistakes";
import { PermissionRefused } from "@/lib/permission/check";
import { setActsStopped } from "@/lib/permission/stop";
import { grantArea, revokeArea } from "@/lib/standing-permission";
import { requireUser } from "@/lib/session";

const AREAS: readonly string[] = SECTORS;

// One tap per area: Jane handles it under the limit, or goes back to asking.
export async function setAreaStanding(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sector = String(formData.get("sector") ?? "");
  if (!AREAS.includes(sector)) return;
  try {
    if (formData.get("on") === "1") await grantArea(user.id, sector as Sector);
    else await revokeArea(user.id, sector as Sector);
  } catch (error) {
    // A real account never sees the button; asked anyway, nothing changes.
    if (!(error instanceof PermissionRefused)) throw error;
  }
  revalidatePath("/jane");
}

// "This was wrong" on something Jane did.
export async function reportAct(formData: FormData): Promise<void> {
  const user = await requireUser();
  const actId = String(formData.get("actId") ?? "").slice(0, 100);
  if (!actId) return;
  try {
    await reportMistake(user.id, actId, String(formData.get("note") ?? ""));
  } catch (error) {
    if (!(error instanceof MistakeError)) throw error;
  }
  revalidatePath("/jane");
}

// The stop-all switch on /jane: nothing passes the permission check while it's on.
export async function setStopAll(formData: FormData): Promise<void> {
  const user = await requireUser();
  await setActsStopped(user.id, formData.get("stop") === "1");
  revalidatePath("/jane");
}
