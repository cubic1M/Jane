"use server";

import { redirect } from "next/navigation";
import { runCheckup } from "@/lib/insurance/checkups";
import { requireUser } from "@/lib/session";

// "Check again" on the checkup page (spec step 106).
export async function checkAgain(): Promise<void> {
  const user = await requireUser();
  await runCheckup(user.id, "asked");
  redirect("/insurance/checkup");
}
