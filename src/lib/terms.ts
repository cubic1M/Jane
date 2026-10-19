import { TERMS_VERSION } from "@/config/legal";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";

// Records that a person accepted the current Terms and Privacy Policy.

// Carries a sign-up's consent across the magic link or Google redirect, until the account
// exists. If the link is opened elsewhere, the person accepts on /terms/accept instead.
export const TERMS_COOKIE = "fc_terms";

export async function acceptTerms(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: { client?: PrismaClient; now?: Date; via: "signup" | "prompt" | "trial" },
): Promise<void> {
  await client.user.update({
    where: { id: userId },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "terms_accepted",
    { type: "user", id: userId },
    {
      version: TERMS_VERSION,
      via,
    },
  );
}
