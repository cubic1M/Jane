import { SPECIALISTS, type SpecialistInfo, type SpecialistKey } from "@/config/specialists";
import { CONCIERGE_ACTIONS } from "@/config/concierge";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import type { PrismaClient } from "@/generated/prisma/client";
import { mailMode } from "@/lib/agent/mail";
import { conciergeMode } from "@/lib/concierge-mode";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { isTrialUser } from "@/lib/trial-ids";

// One registry of specialists: what each does, stand-in or real, on or off for this person. Each
// sector keeps its own interface and its own way of picking a partner; this only answers for all of
// them at once. Real accounts have every specialist off.

// A real specialist is on only with its flag. Both flags stay false until a licensed partner and
// counsel's sign-off; everything without a flag has none.
export function realSpecialistOn(key: SpecialistKey): boolean {
  if (key === "money_movement") return (REAL_MONEY_MOVEMENT as boolean) === true;
  if (key === "email_agent" || key === "phone_agent") {
    return (CONCIERGE_ACTIONS.realAccounts as boolean) === true;
  }
  return false;
}

// Whether nothing real happens when it acts. A stand-in never touches anything real; the email agent
// is real only when it's sending real mail for a non-trial person.
export function isSimulated(key: SpecialistKey, userId: string): boolean {
  const info = SPECIALISTS.find((s) => s.key === key)!;
  if (info.kind === "stand_in" && key !== "email_agent") return true;
  if (key === "email_agent") return isTrialUser(userId) || mailMode(userId) !== "email";
  return false;
}

export type SpecialistView = SpecialistInfo & {
  // Whether Jane may use it for this person now.
  on: boolean;
  // What the person is told: nothing real happens.
  simulated: boolean;
};

export async function specialistsFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<SpecialistView[]> {
  const [concierge, advice] = await Promise.all([
    conciergeMode(userId, { client }),
    adviceMode(userId, { client }),
  ]);
  return SPECIALISTS.map((s) => ({
    ...s,
    on: s.kind === "real" ? realSpecialistOn(s.key) : concierge || advice,
    simulated: isSimulated(s.key, userId),
  }));
}
