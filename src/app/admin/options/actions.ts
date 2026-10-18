"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { validateOption, type OptionInput } from "@/lib/switch-options";

export type OptionState = { ok: boolean; message: string } | null;

const FIELDS = [
  "kind",
  "category",
  "merchant",
  "provider",
  "name",
  "monthly",
  "apy",
  "contractMonths",
  "fee",
  "minimumBalance",
  "includes",
  "givesUp",
  "signUpUrl",
  "sourceUrl",
  "checkedAt",
] as const;

const today = () => new Date().toISOString().slice(0, 10);

// Adds an option Jane may compare (spec step 76).
export async function saveOption(_previous: OptionState, formData: FormData): Promise<OptionState> {
  const admin = await requireAdmin();
  const input = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")])) as Omit<
    OptionInput,
    "reviewed"
  >;
  const checked = validateOption(
    { ...input, reviewed: formData.get("reviewed") === "on" },
    today(),
  );
  if (!checked.ok) return checked;
  const saved = await db.switchOption.create({ data: checked.data, select: { id: true } });
  await logAudit(
    { type: "admin", id: admin.id },
    "switch_option_saved",
    { type: "switch_option", id: saved.id },
    { kind: checked.data.kind, reviewed: checked.data.reviewedAt !== null },
  );
  revalidatePath("/admin/options");
  return { ok: true, message: `Added ${checked.data.name}.` };
}

// "Checked today": the team confirmed the price on the provider's page just now.
export async function markChecked(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const { count } = await db.switchOption.updateMany({
    where: { id, demo: false },
    data: { checkedAt: new Date(`${today()}T00:00:00Z`), reviewedAt: new Date() },
  });
  if (count === 0) return;
  await logAudit(
    { type: "admin", id: admin.id },
    "switch_option_reviewed",
    { type: "switch_option", id },
    {},
  );
  revalidatePath("/admin/options");
}

export async function removeOption(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const { count } = await db.switchOption.deleteMany({ where: { id, demo: false } });
  if (count === 0) return;
  await logAudit(
    { type: "admin", id: admin.id },
    "switch_option_removed",
    { type: "switch_option", id },
    {},
  );
  revalidatePath("/admin/options");
}
