"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { DemoBankError, linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { hit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

// "Link a demo bank" (spec step 75): creates the demo item, runs its first sync after the
// response like a real link, and goes to the scan screen, then Jane's chat (spec step 82).
export async function linkDemo(): Promise<void> {
  const user = await requireUser();
  if (!(await hit("plaid", user.id)).ok) redirect("/connect");
  let itemId: string;
  let created: boolean;
  try {
    ({ itemId, created } = await linkDemoBank(user.id));
  } catch (error) {
    if (error instanceof DemoBankError) redirect("/connect");
    throw error;
  }
  if (created) {
    after(async () => {
      try {
        await syncItem(itemId, { progressive: true });
      } catch (error) {
        console.error("First demo bank sync failed", { itemId, error: String(error) });
      }
    });
  }
  redirect("/scanning?then=chat");
}
