"use server";

import { revalidatePath } from "next/cache";
import { TransferError, cancelTransfer } from "@/lib/money-movement/transfers";
import { requireUser } from "@/lib/session";

// Undo a transfer while it's pending (spec step 144).
export async function undoTransfer(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await cancelTransfer(user.id, String(formData.get("transferId") ?? ""));
  } catch (error) {
    if (!(error instanceof TransferError)) throw error;
  }
  revalidatePath("/transfers");
}
