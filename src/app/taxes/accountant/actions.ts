"use server";

import { revalidatePath } from "next/cache";
import {
  AccountantError,
  createAccountantLink,
  markNotesSeen,
  revokeAccountantLink,
} from "@/lib/accountant";
import { dayLabel } from "@/lib/day-label";
import { requireUser } from "@/lib/session";

// Working with an accountant (spec step 222): make a read-only link, revoke one, and mark
// the accountant's answers as seen.

export type AccountantState = { ok: boolean; message: string; url?: string } | null;

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();

export async function accountantAction(
  _previous: AccountantState,
  formData: FormData,
): Promise<AccountantState> {
  const user = await requireUser();
  const intent = text(formData, "intent");
  try {
    if (intent === "create") {
      const link = await createAccountantLink(user.id, {
        label: text(formData, "label"),
        days: Number(text(formData, "days")),
      });
      revalidatePath("/taxes/accountant");
      return {
        ok: true,
        message: `Here is your link. It shows only your tax information and stops working on ${dayLabel(link.expiresOn, { year: true })}. Copy it now: I can't show it again.`,
        url: link.url,
      };
    }
    if (intent === "revoke") {
      await revokeAccountantLink(user.id, text(formData, "id"));
      revalidatePath("/taxes/accountant");
      return { ok: true, message: "Revoked. That link no longer works." };
    }
    if (intent === "seen") {
      await markNotesSeen(user.id);
      revalidatePath("/taxes/accountant");
      return { ok: true, message: "Marked as read." };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof AccountantError) return { ok: false, message: error.message };
    throw error;
  }
}
