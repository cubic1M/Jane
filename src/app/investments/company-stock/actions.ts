"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CompanyStockError,
  linkDemoStockPlan,
  saveGrant,
  sellPart,
} from "@/lib/investments/company-stock";
import { requireUser } from "@/lib/session";

// The company stock page's buttons and form (spec step 160).

export type GrantState = { message: string } | null;

export async function addGrant(_previous: GrantState, formData: FormData): Promise<GrantState> {
  const user = await requireUser();
  const field = (name: string) => String(formData.get(name) ?? "");
  try {
    await saveGrant(user.id, {
      company: field("company"),
      ticker: field("ticker"),
      kind: field("kind"),
      unvestedShares: field("unvestedShares"),
      sharesPerVest: field("sharesPerVest"),
      everyMonths: field("everyMonths"),
      nextVestOn: field("nextVestOn"),
    });
  } catch (error) {
    if (error instanceof CompanyStockError) return { message: error.message };
    throw error;
  }
  redirect("/investments/company-stock?done=saved");
}

export async function linkStockPlan(): Promise<void> {
  const user = await requireUser();
  try {
    await linkDemoStockPlan(user.id);
  } catch (error) {
    if (!(error instanceof CompanyStockError)) throw error;
  }
  revalidatePath("/investments");
  redirect("/investments/company-stock?done=linked");
}

export async function sellNow(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await sellPart(user.id, String(formData.get("key") ?? ""));
  } catch (error) {
    if (!(error instanceof CompanyStockError)) throw error;
    redirect("/investments/company-stock");
  }
  revalidatePath("/investments");
  redirect("/investments/company-stock?done=sold");
}
