"use server";

import { redirect } from "next/navigation";
import {
  answerPremium,
  CostlyProductError,
  linkDemoProducts,
  saveProduct,
} from "@/lib/investments/costly-products";
import { requireUser } from "@/lib/session";

// The costly products page's buttons and form (spec step 215). Nothing here leaves or
// cancels anything: it only records what the person tells Jane.

export type ProductState = { message: string } | null;

export async function addProduct(
  _previous: ProductState,
  formData: FormData,
): Promise<ProductState> {
  const user = await requireUser();
  const f = (name: string) => String(formData.get(name) ?? "");
  try {
    await saveProduct(user.id, {
      kind: f("kind"),
      name: f("name"),
      provider: f("provider"),
      value: f("value"),
      feePercent: f("feePercent"),
      premiumYearly: f("premiumYearly"),
      purchasedYear: f("purchasedYear"),
      purchasedMonth: f("purchasedMonth"),
      schedule: f("schedule"),
    });
  } catch (error) {
    if (error instanceof CostlyProductError) return { message: error.message };
    throw error;
  }
  redirect("/investments/costly-products?done=saved");
}

export async function answer(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await answerPremium(user.id, String(formData.get("id") ?? ""), formData.get("yes") === "yes");
  } catch (error) {
    if (!(error instanceof CostlyProductError)) throw error;
  }
  redirect("/investments/costly-products");
}

export async function demoProducts(): Promise<void> {
  const user = await requireUser();
  try {
    await linkDemoProducts(user.id);
  } catch (error) {
    if (!(error instanceof CostlyProductError)) throw error;
  }
  redirect("/investments/costly-products?done=linked");
}
