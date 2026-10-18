import { AUTOPILOT_LEVELS, type AutopilotChoice } from "@/config/autopilot";
import { RULE_DEFAULT_MONTHLY_LIMIT, STANDING_RULES } from "@/config/rules";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { applyStandingRules, saveRules } from "@/lib/standing-rules";

// Autopilot (spec step 57): the person's one choice of how much Jane does on its own. It
// sets every standing rule, then applies them straight away.

type Options = { client?: PrismaClient; now?: Date };

export class AutopilotError extends Error {}

export const isAutopilotChoice = (value: unknown): value is AutopilotChoice =>
  typeof value === "string" && Object.hasOwn(AUTOPILOT_LEVELS, value);

// Returns how many open items the new level approved at once.
export async function setAutopilot(
  userId: string,
  level: unknown,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  if (!isAutopilotChoice(level)) throw new AutopilotError("Pick one of the choices.");
  const chosen = AUTOPILOT_LEVELS[level].rules;
  await saveRules(
    userId,
    STANDING_RULES.map((rule) => ({
      key: rule.key,
      enabled: rule.key in chosen,
      monthlyLimit: chosen[rule.key]?.limit ?? RULE_DEFAULT_MONTHLY_LIMIT,
      maxAnnualCents: rule.maxAmount
        ? (chosen[rule.key]?.maxAnnualCents ?? rule.maxAmount.defaultCents)
        : null,
    })),
    { client },
  );
  await client.user.update({ where: { id: userId }, data: { autopilot: level } });
  await logAudit(
    { type: "user", id: userId },
    "autopilot_set",
    { type: "user", id: userId },
    {
      level,
    },
  );
  await track(userId, "autopilot_set", { level });
  const approvals = await applyStandingRules(userId, { client, now });
  return approvals.length;
}

// Fine-tuning rules by hand moves the person to "custom".
export async function markCustom(userId: string, { client = defaultClient }: Options = {}) {
  await client.user.update({ where: { id: userId }, data: { autopilot: "custom" } });
}

export async function autopilotOf(userId: string, { client = defaultClient }: Options = {}) {
  const user = await client.user.findUnique({ where: { id: userId }, select: { autopilot: true } });
  return user?.autopilot ?? null;
}
