"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  NoticeError,
  chooseResponse,
  confirmTaxNotice,
  dismissTaxNotice,
  sendResponse,
} from "@/lib/tax-notices";
import { fieldsFrom } from "./fields";

// Letters from the IRS and the state (spec step 217): confirming what Jane read, choosing a
// response and sending it, each on the person's tap.

export type LetterState = { ok: boolean; message: string } | null;

export async function letterAction(
  _previous: LetterState,
  formData: FormData,
): Promise<LetterState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  const id = String(formData.get("id") ?? "");
  try {
    if (intent === "confirm") {
      await confirmTaxNotice(user.id, id, { fields: fieldsFrom(formData) });
      revalidatePath("/taxes/letters");
      return { ok: true, message: "Confirmed. The date it's due is on your deadlines." };
    }
    if (intent === "dismiss") {
      await dismissTaxNotice(user.id, id);
      revalidatePath("/taxes/letters");
      return { ok: true, message: "OK. Jane won't use it." };
    }
    if (intent === "agree" || intent === "pay" || intent === "dispute") {
      await chooseResponse(user.id, id, intent);
      revalidatePath("/taxes/letters");
      return { ok: true, message: "Here's a draft. Nothing is sent until you tap." };
    }
    if (intent === "team" || intent === "you") {
      await sendResponse(user.id, id, intent);
      revalidatePath("/taxes/letters");
      return {
        ok: true,
        message:
          intent === "team"
            ? "Jane's team has it and will send it."
            : "OK: it's yours to send. Keep a copy.",
      };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof NoticeError) return { ok: false, message: error.message };
    throw error;
  }
}
