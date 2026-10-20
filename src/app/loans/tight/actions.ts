"use server";

import { redirect } from "next/navigation";
import { TightMoneyError, sendTightItem } from "@/lib/tight-money";
import { requireUser } from "@/lib/session";

// "Send" on /loans/tight (spec step 177): one prepared request, only on the person's tap.
export async function sendRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await sendTightItem(user.id, String(formData.get("itemId") ?? ""));
  } catch (error) {
    if (error instanceof TightMoneyError) {
      redirect(`/loans/tight?${new URLSearchParams({ error: error.message })}`);
    }
    throw error;
  }
  redirect("/loans/tight?sent=1");
}
