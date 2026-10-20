"use server";

import { revalidatePath } from "next/cache";
import {
  MultiYearError,
  addPlanEvent,
  putMoveOnPlan,
  removePlanEvent,
  setRetireYear,
} from "@/lib/multi-year";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Tax moves over several years (spec step 220): the retirement year, planned events, and
// putting a move on the deadlines.

export type YearsState = { ok: boolean; message: string } | null;

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();

export async function yearsAction(_previous: YearsState, formData: FormData): Promise<YearsState> {
  const user = await requireUser();
  const intent = text(formData, "intent");
  try {
    if (intent === "retire") {
      const raw = text(formData, "retireYear");
      await setRetireYear(user.id, raw ? Number(raw) : null, { via: "page" });
      revalidatePath("/taxes/years");
      return { ok: true, message: "Saved. The plan uses it now." };
    }
    if (intent === "add") {
      const amount = parseMoneyToCents(text(formData, "amount"));
      if (amount === null) throw new MultiYearError("Give the amount in dollars.");
      await addPlanEvent(
        user.id,
        { kind: text(formData, "kind"), year: Number(text(formData, "year")), amountCents: amount },
        { via: "page" },
      );
      revalidatePath("/taxes/years");
      return { ok: true, message: "Added. Jane looks for its best year." };
    }
    if (intent === "remove") {
      await removePlanEvent(user.id, text(formData, "id"));
      revalidatePath("/taxes/years");
      return { ok: true, message: "Removed." };
    }
    if (intent === "plan") {
      const move = await putMoveOnPlan(user.id, text(formData, "key"), { via: "page" });
      revalidatePath("/taxes/years");
      revalidatePath("/deadlines");
      return { ok: true, message: `On your deadlines: ${move.title}.` };
    }
    return { ok: false, message: "Something went wrong. Try again." };
  } catch (error) {
    if (error instanceof MultiYearError) return { ok: false, message: error.message };
    throw error;
  }
}
