"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addChild,
  contributeForChild,
  createGiftLink,
  FamilyError,
  openChildAccount,
  revokeGiftLinks,
} from "@/lib/investments/family";
import { requireUser } from "@/lib/session";

// The family investing page's buttons (spec step 213). Money in is always the person's tap.

const BASE = "/investments/family";
const go = (done: string) => redirect(`${BASE}?done=${done}`);

export async function saveChild(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await addChild(user.id, {
      name: String(formData.get("name") ?? ""),
      age: Math.round(Number(formData.get("age"))),
      earnedCents: Math.round(
        Number(String(formData.get("earned") ?? "0").replace(/[$,]/g, "")) * 100,
      ),
    });
  } catch (error) {
    if (!(error instanceof FamilyError)) throw error;
    go("check");
  }
  go("saved");
}

export async function openAccount(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await openChildAccount(
      user.id,
      formData.get("kind") === "child_roth" ? "child_roth" : "custodial",
    );
  } catch (error) {
    if (!(error instanceof FamilyError)) throw error;
  }
  revalidatePath("/investments");
  go("opened");
}

export async function putIn(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await contributeForChild(
      user.id,
      String(formData.get("child") ?? ""),
      formData.get("kind") === "child_roth" ? "child_roth" : "custodial",
      Math.round(Number(String(formData.get("amount") ?? "").replace(/[$,]/g, "")) * 100),
    );
  } catch (error) {
    if (!(error instanceof FamilyError)) throw error;
    go("check");
  }
  revalidatePath("/investments");
  go("contributed");
}

export async function makeLink(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await createGiftLink(user.id, String(formData.get("plan") ?? ""));
  } catch (error) {
    if (!(error instanceof FamilyError)) throw error;
    go("check");
  }
  go("linked");
}

export async function takeDown(): Promise<void> {
  const user = await requireUser();
  await revokeGiftLinks(user.id);
  go("revoked");
}
