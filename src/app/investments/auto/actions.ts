"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AutoInvestError,
  setAutoInvestStatus,
  startAutoInvest,
} from "@/lib/investments/auto-invest";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { ignoring } from "@/lib/ignoring";

// Automatic investing from its page (spec step 134): set up or change, pause, resume.

export type AutoInvestState = { message: string } | null;

export async function saveAutoInvest(
  _previous: AutoInvestState,
  formData: FormData,
): Promise<AutoInvestState> {
  const user = await requireUser();
  const mode = formData.get("mode") === "leftover" ? "leftover" : "fixed";
  const amountCents =
    mode === "fixed" ? parseMoneyToCents(String(formData.get("amount") ?? "")) : null;
  try {
    await startAutoInvest(user.id, {
      mode,
      amountCents,
      accountId: String(formData.get("accountId") ?? ""),
    });
  } catch (error) {
    if (error instanceof AutoInvestError) return { message: error.message };
    throw error;
  }
  revalidatePath("/investments");
  redirect("/investments/auto?saved=1");
}

export async function toggleAutoInvest(formData: FormData): Promise<void> {
  const user = await requireUser();
  await ignoring(AutoInvestError, () =>
    setAutoInvestStatus(user.id, formData.get("status") === "paused" ? "paused" : "active"),
  );
  redirect("/investments/auto");
}
