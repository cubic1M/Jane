import { randomBytes } from "node:crypto";
import { personById, type PersonId } from "@/config/people";
import { TRIAL_EMAIL_DOMAIN, TRIAL_HOURS, TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { demoBankEnabled, linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { acceptTerms } from "@/lib/terms";

// Try Jane without signing up (spec step 138): a temporary sample person with the demo
// bank and demo advice (src/lib/advice-mode.ts), signed in with a session that ends after
// TRIAL_HOURS, then deleted with everything they did. Nothing contacts a company: the agent
// writes to the simulated company and calls the simulated number (src/lib/agent/mail.ts,
// src/lib/voice/provider.ts), and no email goes out (src/lib/email.ts). Trial people are
// never in analytics or the team's metrics.

type Options = { client?: PrismaClient; now?: Date };

const HOUR_MS = 60 * 60 * 1000;

export { isTrialEmail, isTrialUser } from "@/lib/trial-ids";

// Offered wherever the demo bank is, and in production only with TRY_JANE=1.
export function trialEnabled(): boolean {
  if (!demoBankEnabled()) return false;
  return process.env.NODE_ENV !== "production" || process.env.TRY_JANE === "1";
}

export class TrialError extends Error {}

// Deletes every trial person whose time is up. Deleting the user removes everything they
// own (every table cascades from users).
export async function cleanUpTrials({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<number> {
  const { count } = await client.user.deleteMany({
    where: {
      id: { startsWith: TRIAL_ID_PREFIX },
      createdAt: { lt: new Date(now.getTime() - TRIAL_HOURS * HOUR_MS) },
    },
  });
  return count;
}

// A new trial person with the demo bank linked and a session for them. With `defer` only
// the minimum is done (the user, the Terms, the linked demo item and the session) and the
// first sync is left to the caller to run afterwards (the response must not wait on it:
// /scanning shows progress while it runs); without it the first sync runs here too.
export async function startTrial({
  client = defaultClient,
  now = new Date(),
  userAgent = null,
  defer = false,
  person,
}: Options & { userAgent?: string | null; defer?: boolean; person?: PersonId } = {}): Promise<{
  userId: string;
  itemId: string;
  sessionToken: string;
  expires: Date;
}> {
  if (!trialEnabled()) throw new TrialError("Trying Jane isn't available here.");
  // Cleaning up other people's finished trials isn't this visitor's wait.
  if (!defer) await cleanUpTrials({ client, now });
  const id = `${TRIAL_ID_PREFIX}${randomBytes(12).toString("hex")}`;
  // Users have their own helpers; a trial person is made here and nowhere else.
  await client.user.create({
    data: {
      id,
      email: `${id}@${TRIAL_EMAIL_DOMAIN}`,
      name: person ? (personById(person)?.name ?? "Sample person") : "Sample person",
      createdAt: now,
    },
  });
  // The visitor ticked "I agree" to try it (src/app/try/actions.ts), as at sign-up.
  await acceptTerms(id, { client, now, via: "trial" });
  const { itemId } = await linkDemoBank(id, { client, now, person });
  if (!defer) await syncItem(itemId, { client, now });
  const expires = new Date(now.getTime() + TRIAL_HOURS * HOUR_MS);
  const sessionToken = randomBytes(32).toString("hex");
  await client.session.create({
    data: { sessionToken, userId: id, expires, userAgent: userAgent?.slice(0, 200) ?? null },
  });
  return { userId: id, itemId, sessionToken, expires };
}
