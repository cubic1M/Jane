"use server";

import { revalidatePath } from "next/cache";
import { STANDING_RULES } from "@/config/rules";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { RuleError, saveRules } from "@/lib/standing-rules";

export type RulesState = { ok: boolean; message: string } | null;

export async function saveStandingRules(
  _previous: RulesState,
  formData: FormData,
): Promise<RulesState> {
  const user = await requireUser();
  const rules = STANDING_RULES.map((rule) => {
    const max = String(formData.get(`${rule.key}.max`) ?? "").trim();
    return {
      key: rule.key,
      enabled: formData.get(`${rule.key}.enabled`) === "on",
      monthlyLimit: Number(formData.get(`${rule.key}.limit`)),
      maxAnnualCents: rule.maxAmount ? (max ? parseMoneyToCents(max) : null) : null,
    };
  });
  try {
    await saveRules(user.id, rules);
  } catch (error) {
    if (error instanceof RuleError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/settings");
  const on = rules.filter((r) => r.enabled).length;
  return {
    ok: true,
    message:
      on === 0
        ? "Saved. No rules are on: Jane asks you about everything."
        : `Saved. ${on} ${on === 1 ? "rule is" : "rules are"} on; Jane uses them after each update from your bank.`,
  };
}
