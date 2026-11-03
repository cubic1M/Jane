"use server";

import { revalidatePath } from "next/cache";
import { setActsStopped } from "@/lib/permission/stop";
import { requireUser } from "@/lib/session";

// The stop-all switch on /jane: nothing passes the permission check while it's on.
export async function setStopAll(formData: FormData): Promise<void> {
  const user = await requireUser();
  await setActsStopped(user.id, formData.get("stop") === "1");
  revalidatePath("/jane");
}
