"use server";

import { revalidatePath } from "next/cache";
import { TransferError, cancelTransfer } from "@/lib/money-movement/transfers";
import { requireUser } from "@/lib/session";
import { ignoring } from "@/lib/ignoring";

// Undo a transfer while it's pending (spec step 144).
export async function undoTransfer(formData: FormData): Promise<void> {
  const user = await requireUser();
  await ignoring(TransferError, () =>
    cancelTransfer(user.id, String(formData.get("transferId") ?? "")),
  );
  revalidatePath("/transfers");
}
