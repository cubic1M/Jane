"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { parseMoneyToCents } from "@/lib/money";
import {
  TaxCorrectionError,
  addTaxCorrection,
  isCorrectionKind,
  removeTaxCorrection,
} from "@/lib/tax-corrections";

// /taxes: what a person points out on their tax calculation, and undoing it. Everything built on the
// estimate moves with it, so Home's Safe to spend is worked out again too.

export type PointOutState = { ok: boolean; message: string } | null;

const changed = () => {
  revalidatePath("/taxes");
  revalidatePath("/home");
  revalidatePath("/figures/safe_to_spend");
};

const AGAIN: PointOutState = { ok: false, message: "Something went wrong. Try again." };

export async function pointOutAction(
  _previous: PointOutState,
  formData: FormData,
): Promise<PointOutState> {
  const user = await requireUser();
  // "paid_federal" and "paid_state" are one kind, to two places.
  const what = String(formData.get("kind") ?? "");
  const kind = what.startsWith("paid_") ? "paid" : what;
  if (!isCorrectionKind(kind)) return AGAIN;
  try {
    if (kind === "not_income") {
      const payerKey = String(formData.get("payerKey") ?? "");
      if (!payerKey) return AGAIN;
      await addTaxCorrection(user.id, { kind, payerKey }, { via: "page" });
    } else {
      const cents = parseMoneyToCents(String(formData.get("amount") ?? ""));
      if (cents === null) return { ok: false, message: "Enter an amount in dollars." };
      const label = String(formData.get("label") ?? "");
      if (kind === "paid")
        await addTaxCorrection(
          user.id,
          { kind, cents, label, paidTo: what === "paid_state" ? "state" : "federal" },
          { via: "page" },
        );
      else await addTaxCorrection(user.id, { kind, cents, label }, { via: "page" });
    }
  } catch (error) {
    if (error instanceof TaxCorrectionError) return { ok: false, message: error.message };
    throw error;
  }
  changed();
  return { ok: true, message: "Thanks. Jane worked it out again with that." };
}

export async function undoPointOutAction(
  _previous: PointOutState,
  formData: FormData,
): Promise<PointOutState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return AGAIN;
  try {
    await removeTaxCorrection(user.id, id, { via: "page" });
  } catch (error) {
    if (error instanceof TaxCorrectionError) return { ok: false, message: error.message };
    throw error;
  }
  changed();
  return { ok: true, message: "Undone." };
}
