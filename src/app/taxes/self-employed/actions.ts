"use server";

import { revalidatePath } from "next/cache";
import { adviceMode } from "@/lib/advice-mode";
import { parseMoneyToCents } from "@/lib/money";
import {
  SelfEmployedError,
  recordTaxPayment,
  saveHomeOffice,
  saveMiles,
} from "@/lib/self-employed";
import { requireUser } from "@/lib/session";

// Freelance taxes (spec step 123): the home office, business miles and an estimated tax
// payment made from an account Jane can't see.

export type HelperState = { ok: boolean; message: string } | null;

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export async function saveHelper(_previous: HelperState, formData: FormData): Promise<HelperState> {
  const user = await requireUser();
  try {
    switch (text(formData, "intent")) {
      case "office": {
        const sqft = text(formData, "sqft");
        await saveHomeOffice(user.id, sqft ? (/^\d+$/.test(sqft) ? Number(sqft) : NaN) : null, {
          via: "page",
        });
        break;
      }
      case "miles": {
        const miles = text(formData, "miles").replaceAll(",", "");
        await saveMiles(user.id, /^\d+$/.test(miles) ? Number(miles) : NaN, { via: "page" });
        break;
      }
      case "payment": {
        if (!(await adviceMode(user.id)))
          return { ok: false, message: "That's only in demo advice mode." };
        const cents = parseMoneyToCents(text(formData, "amount"));
        const to = text(formData, "to") === "state" ? "state" : "federal";
        await recordTaxPayment(
          user.id,
          { date: text(formData, "date"), cents: cents ?? NaN, to },
          { via: "page" },
        );
        break;
      }
      default:
        return { ok: false, message: "Something went wrong. Try again." };
    }
    revalidatePath("/taxes/self-employed");
    revalidatePath("/taxes");
    return { ok: true, message: "Saved. Your estimate uses it now." };
  } catch (error) {
    if (error instanceof SelfEmployedError) return { ok: false, message: error.message };
    throw error;
  }
}
