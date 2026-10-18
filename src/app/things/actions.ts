"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AssetError,
  addAsset,
  removeAsset,
  updateAsset,
  type AssetInput,
} from "@/lib/owned-assets";
import { requireUser } from "@/lib/session";

// Things you own (spec step 67). A save or remove goes back to /things with ?saved=, so
// the confirmation shows on the freshly loaded list.

// On a problem, the message and what they typed, so the form keeps it.
export type AssetState = { message: string; input: AssetInput } | null;

const inputOf = (formData: FormData): AssetInput => ({
  kind: String(formData.get("kind") ?? ""),
  name: String(formData.get("name") ?? ""),
  value: String(formData.get("value") ?? ""),
  valuedOn: String(formData.get("valuedOn") ?? ""),
  loanAccountId: String(formData.get("loanAccountId") ?? ""),
});

// The other pages that count these values.
function refreshOthers() {
  revalidatePath("/net-worth");
  revalidatePath("/loans");
  revalidatePath("/home");
}

export async function saveAsset(_previous: AssetState, formData: FormData): Promise<AssetState> {
  const user = await requireUser();
  const assetId = String(formData.get("assetId") ?? "");
  const input = inputOf(formData);
  try {
    if (assetId) await updateAsset(user.id, assetId, input);
    else await addAsset(user.id, input);
  } catch (error) {
    if (error instanceof AssetError) return { message: error.message, input };
    throw error;
  }
  refreshOthers();
  redirect(`/things?saved=${assetId ? "updated" : "added"}`);
}

export async function deleteAsset(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await removeAsset(user.id, String(formData.get("assetId") ?? ""));
  } catch (error) {
    // Already gone, or not theirs: nothing to remove.
    if (error instanceof AssetError) redirect("/things");
    throw error;
  }
  refreshOthers();
  redirect("/things?saved=removed");
}
