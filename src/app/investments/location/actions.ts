"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LocationError, makeSwaps } from "@/lib/investments/location";
import { requireUser } from "@/lib/session";

// The location page's buttons (spec step 231). Each swap is the person's tap.

export async function swapNow(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await makeSwaps(
      user.id,
      String(formData.get("plan") ?? ""),
      String(formData.get("which") ?? "free"),
    );
  } catch (error) {
    if (!(error instanceof LocationError)) throw error;
    redirect("/investments/location?done=changed");
  }
  revalidatePath("/investments");
  redirect("/investments/location?done=swapped");
}
