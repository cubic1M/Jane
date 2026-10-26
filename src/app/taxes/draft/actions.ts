"use server";

import { revalidatePath } from "next/cache";
import {
  DraftReturnError,
  addSampleDraft,
  confirmDraftReturn,
  dismissDraftReturn,
} from "@/lib/draft-return";
import { requireUser } from "@/lib/session";
import { draftFieldsFrom } from "./fields";

// Your draft return (spec step 272): confirming what Jane read (then it checks it), or saying
// it isn't a draft return. Nothing here files anything.

export type DraftState = { ok: boolean; message: string } | null;

export async function draftAction(_previous: DraftState, formData: FormData): Promise<DraftState> {
  const user = await requireUser();
  const intent = String(formData.get("intent") ?? "");
  const id = String(formData.get("id") ?? "");
  try {
    if (intent === "confirm") {
      const v = await confirmDraftReturn(user.id, id, { fields: draftFieldsFrom(formData) });
      revalidatePath("/taxes/draft");
      return {
        ok: true,
        message:
          v.findings.length === 0
            ? "Confirmed. Jane checked it and found nothing to fix."
            : `Confirmed. Jane checked it: ${v.findings.length} thing${v.findings.length === 1 ? "" : "s"} to look at before you file.`,
      };
    }
    if (intent === "sample") {
      await addSampleDraft(user.id);
      revalidatePath("/taxes/draft");
      return { ok: true, message: "Here is the sample draft. Check what Jane read, then confirm." };
    }
    if (intent === "dismiss") {
      await dismissDraftReturn(user.id, id);
      revalidatePath("/taxes/draft");
      return { ok: true, message: "OK. Jane won't use it." };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof DraftReturnError) return { ok: false, message: error.message };
    throw error;
  }
}
