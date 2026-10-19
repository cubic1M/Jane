"use server";

import { revalidatePath } from "next/cache";
import { isTaxTagKind, UNTAGGED } from "@/config/tax";
import { requireUser } from "@/lib/session";
import { TaxOrganizerError, setTaxTag } from "@/lib/tax-organizer";

// Tax tags (spec step 119): the person's own tag on one transaction, or on every charge
// from a merchant (Jane's "is this right?" questions). Checked in setTaxTag.

export type TagState = { ok: boolean; message: string } | null;

export async function changeTag(_previous: TagState, formData: FormData): Promise<TagState> {
  const user = await requireUser();
  const tag = String(formData.get("tag") ?? "");
  const transactionId = String(formData.get("transactionId") ?? "");
  const merchantKey = String(formData.get("merchantKey") ?? "");
  if (tag !== UNTAGGED && !isTaxTagKind(tag)) return { ok: false, message: "Pick a tag." };
  try {
    const target = transactionId ? { transactionId } : { merchantKey };
    const { count } = await setTaxTag(user.id, target, tag === UNTAGGED ? null : tag, {
      via: "page",
    });
    revalidatePath("/taxes/tags");
    revalidatePath("/tax-pack");
    return { ok: true, message: count === 1 ? "Saved." : `Saved for all ${count}.` };
  } catch (error) {
    if (error instanceof TaxOrganizerError) return { ok: false, message: error.message };
    throw error;
  }
}
