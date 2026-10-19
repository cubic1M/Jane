"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { FilingError, signReturn, startReturn } from "@/lib/tax-filing";

// Filing (spec step 126): starting the return, and the person's review and signature.

export type FileState = { ok: boolean; message: string } | null;

export async function fileAction(_previous: FileState, formData: FormData): Promise<FileState> {
  const user = await requireUser();
  try {
    if (formData.get("intent") === "start") {
      await startReturn(user.id, { via: "page" });
      revalidatePath("/taxes/file");
      return { ok: true, message: "Your return is ready to review." };
    }
    await signReturn(user.id, {
      year: Number(formData.get("year")),
      reviewed: formData.get("reviewed") === "on",
      signature: String(formData.get("signature") ?? ""),
    });
    revalidatePath("/taxes/file");
    revalidatePath("/taxes");
    return { ok: true, message: "Signed and sent. Jane will tell you when it's accepted." };
  } catch (error) {
    if (error instanceof FilingError) return { ok: false, message: error.message };
    throw error;
  }
}
