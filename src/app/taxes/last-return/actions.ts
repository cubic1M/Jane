"use server";

import { revalidatePath } from "next/cache";
import { PriorReturnError, confirmPriorReturn, dismissPriorReturn } from "@/lib/prior-return";
import { requireUser } from "@/lib/session";
import { AmendmentError, prepareAmendment, signAmendment } from "@/lib/tax-amendment";
import { fieldsFrom } from "./fields";

// Last year's return (spec step 172): confirming what Jane read, saying it isn't a return,
// preparing an amended return, and the person's review and signature on it.

export type ReturnState = { ok: boolean; message: string } | null;

export async function returnAction(
  _previous: ReturnState,
  formData: FormData,
): Promise<ReturnState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "confirm") {
      await confirmPriorReturn(user.id, String(formData.get("id") ?? ""), {
        fields: fieldsFrom(formData),
      });
      revalidatePath("/taxes/last-return");
      return { ok: true, message: "Confirmed. Jane is checking it against your accounts." };
    }
    if (intent === "dismiss") {
      await dismissPriorReturn(user.id, String(formData.get("id") ?? ""));
      revalidatePath("/taxes/last-return");
      return { ok: true, message: "OK. Jane won't use it." };
    }
    const year = Number(formData.get("year"));
    if (intent === "prepare") {
      await prepareAmendment(user.id, year, { via: "page" });
      revalidatePath("/taxes/last-return");
      return { ok: true, message: "Your amended return is ready to review." };
    }
    if (intent === "sign") {
      await signAmendment(user.id, {
        year,
        reviewed: formData.get("reviewed") === "on",
        signature: String(formData.get("signature") ?? ""),
      });
      revalidatePath("/taxes/last-return");
      revalidatePath("/taxes");
      return { ok: true, message: "Signed and sent. Jane will tell you when it's accepted." };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof PriorReturnError || error instanceof AmendmentError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
