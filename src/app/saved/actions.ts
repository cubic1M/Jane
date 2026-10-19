"use server";

import { revalidatePath } from "next/cache";
import { revokeSavedShares, shareSavedTotal } from "@/lib/savings-proof";
import { requireUser } from "@/lib/session";

// Sharing the confirmed total (spec step 139): a link to a page with only that number.

export type ShareState = { link: string; message: string } | { link: null; message: string } | null;

export async function shareTotal(): Promise<ShareState> {
  const user = await requireUser();
  const { token, totalCents } = await shareSavedTotal(user.id);
  if (totalCents <= 0) {
    return { link: null, message: "There's nothing confirmed to share yet." };
  }
  return {
    link: `/s/${token}`,
    message: "Your link is ready. Anyone with it sees the total, and nothing else.",
  };
}

export async function stopSharing(): Promise<ShareState> {
  const user = await requireUser();
  const count = await revokeSavedShares(user.id);
  revalidatePath("/saved");
  return {
    link: null,
    message: count === 0 ? "Nothing was shared." : "Done. Your shared links no longer work.",
  };
}
