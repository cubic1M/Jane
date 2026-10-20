"use server";

import { revalidatePath } from "next/cache";
import { EquityTaxError, addEquityEvent, removeEquityEvent, startSetAside } from "@/lib/equity-tax";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Crypto and equity pay (spec step 219): adding an event, removing one, and the goal for
// the tax these bring.

export type EquityState = { ok: boolean; message: string } | null;

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();
const cents = (f: FormData, name: string): number | null => {
  const v = text(f, name);
  if (!v) return null;
  const c = parseMoneyToCents(v);
  if (c === null) throw new EquityTaxError("Prices must be dollars and cents.");
  return c;
};

export async function equityAction(
  _previous: EquityState,
  formData: FormData,
): Promise<EquityState> {
  const user = await requireUser();
  const intent = text(formData, "intent");
  try {
    if (intent === "add") {
      await addEquityEvent(
        user.id,
        {
          kind: text(formData, "kind"),
          company: text(formData, "company"),
          shares: Number(text(formData, "shares")),
          occurredOn: text(formData, "occurredOn"),
          grantedOn: text(formData, "grantedOn") || null,
          priceCents: cents(formData, "price") ?? 0,
          fmvCents: cents(formData, "fmv") ?? 0,
          withheldCents: cents(formData, "withheld"),
          soldOn: text(formData, "soldOn") || null,
          soldPriceCents: cents(formData, "soldPrice"),
          grantDiscountCents: cents(formData, "grantDiscount"),
        },
        { via: "page" },
      );
      revalidatePath("/taxes");
      revalidatePath("/taxes/equity");
      return { ok: true, message: "Added. Your estimate uses it now." };
    }
    if (intent === "remove") {
      await removeEquityEvent(user.id, text(formData, "id"));
      revalidatePath("/taxes/equity");
      return { ok: true, message: "Removed." };
    }
    if (intent === "aside") {
      await startSetAside(user.id, { via: "page" });
      revalidatePath("/taxes/equity");
      return { ok: true, message: "Started. Putting money in is yours." };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof EquityTaxError) return { ok: false, message: error.message };
    throw error;
  }
}
