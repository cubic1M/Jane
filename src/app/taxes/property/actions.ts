"use server";

import { revalidatePath } from "next/cache";
import { parseMoneyToCents } from "@/lib/money";
import {
  PropertyTaxError,
  chooseFiler,
  draftPropertyAppeal,
  markClaimed,
  remindAppealWindow,
  remindExemption,
  savePropertyAnswers,
} from "@/lib/property-tax";
import { requireUser } from "@/lib/session";

// Property tax (spec step 221): what the person tells Jane about their home, the drafted
// appeal and who files it, the deadline, and exemptions. Each is the person's tap.

export type PropertyState = { ok: boolean; message: string } | null;

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();
const cents = (f: FormData, name: string): number | null => {
  const v = text(f, name);
  if (!v) return null;
  const c = parseMoneyToCents(v);
  if (c === null) throw new PropertyTaxError("Values must be dollars and cents.");
  return c;
};
const whole = (f: FormData, name: string): number | null => {
  const v = text(f, name);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new PropertyTaxError("Give whole numbers for ages and years.");
  return n;
};
const yesNo = (f: FormData, name: string): boolean | null => {
  const v = text(f, name);
  return v === "yes" ? true : v === "no" ? false : null;
};

export async function propertyAction(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const user = await requireUser();
  const intent = text(formData, "intent");
  try {
    if (intent === "answers") {
      await savePropertyAnswers(
        user.id,
        {
          marketCents: cents(formData, "market"),
          assessedCents: cents(formData, "assessed"),
          assessedYear: whole(formData, "assessedYear"),
          noticeOn: text(formData, "noticeOn") || null,
          age: whole(formData, "age"),
          veteran: yesNo(formData, "veteran"),
          disabled: yesNo(formData, "disabled"),
        },
        { via: "page" },
      );
      revalidatePath("/taxes/property");
      return { ok: true, message: "Saved. I've checked it again." };
    }
    if (intent === "draft") {
      await draftPropertyAppeal(user.id, { via: "page" });
      revalidatePath("/taxes/property");
      return { ok: true, message: "Drafted. Read it below, then say who files it." };
    }
    if (intent === "team" || intent === "you" || intent === "drop") {
      await chooseFiler(user.id, intent);
      revalidatePath("/taxes/property");
      return {
        ok: true,
        message:
          intent === "team"
            ? "My team has it to file."
            : intent === "you"
              ? "It's yours to file."
              : "Dropped.",
      };
    }
    if (intent === "remind") {
      const closes = await remindAppealWindow(user.id, { via: "page" });
      revalidatePath("/deadlines");
      return { ok: true, message: `The appeal deadline, ${closes}, is on your plan.` };
    }
    if (intent === "exemption_remind") {
      const e = await remindExemption(user.id, text(formData, "key"));
      revalidatePath("/deadlines");
      return { ok: true, message: `Applying for the ${e.name} is on your deadlines.` };
    }
    if (intent === "exemption_claimed") {
      await markClaimed(user.id, [text(formData, "key")]);
      revalidatePath("/taxes/property");
      return { ok: true, message: "Good, I won't bring it up again." };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof PropertyTaxError) return { ok: false, message: error.message };
    throw error;
  }
}
