"use server";

import { revalidatePath } from "next/cache";
import { deletePreference, listPreferences, savePreference } from "@/lib/jane-agent/preferences";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// "That's wrong" on an income figure (spec step 239): what the person earns a month. Saved as
// a remembered fact (listed in Settings, each Forget-able), and read by every sector that
// works from income instead of the average of the deposits.

export type IncomeState = { ok: boolean; message: string } | null;

const MAX_MONTHLY_DOLLARS = 10_000_000;

export async function saveIncome(_previous: IncomeState, formData: FormData): Promise<IncomeState> {
  const user = await requireUser();
  const dollars = Number(String(formData.get("income") ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars > MAX_MONTHLY_DOLLARS) {
    return { ok: false, message: "Enter what you earn in a month, like 4500." };
  }
  const cents = Math.round(dollars * 100);
  await savePreference(user.id, {
    kind: "fact",
    key: "income",
    value: { monthlyCents: cents },
    label: `Income is ${formatCents(cents)} a month`,
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `Got it. I'll use ${formatCents(cents)} a month everywhere.` };
}

export async function clearIncome(): Promise<void> {
  const user = await requireUser();
  const fact = (await listPreferences(user.id)).find(
    (p) => p.kind === "fact" && p.key === "income",
  );
  if (fact) await deletePreference(user.id, fact.id);
  revalidatePath("/", "layout");
}
