import { randomBytes } from "node:crypto";
import { SCAN_MAX_MINUTES } from "@/config/scan";
import {
  TRIAL_EMAIL_DOMAIN,
  TRIAL_HOURS,
  TRIAL_ID_PREFIX,
  TRIAL_POOL_EMAIL_TAG,
  TRIAL_POOL_FRESH_HOURS,
  TRIAL_POOL_SIZE,
  TRIAL_SESSION_PREFIX,
} from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { enqueueJob, runJob } from "@/lib/jobs";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { acceptTerms } from "@/lib/terms";
import { cleanUpTrials, createTrialPerson, trialEnabled } from "@/lib/trial";

// Sample people made ahead for the one-tap demo link, /try (src/app/try/route.ts): the plain
// demo bank, linked and scanned, with no session, no Terms and no Claude card text until
// someone is given one. Handing one out is a single statement, so two visitors never get the
// same person. They are trial people like any other: never emailed, contacted or counted, and
// deleted TRIAL_HOURS after they were made or handed out (cleanUpTrials).

type Options = { client?: PrismaClient; now?: Date };

const HOUR_MS = 60 * 60 * 1000;
const READY_EMAIL_END = `${TRIAL_POOL_EMAIL_TAG}@${TRIAL_EMAIL_DOMAIN}`;

const readyEmail = (id: string) => `${id}${READY_EMAIL_END}`;
const trialCutoff = (now: Date) => new Date(now.getTime() - TRIAL_HOURS * HOUR_MS);

// Made ahead in the last TRIAL_POOL_FRESH_HOURS and not yet handed out: scanned, or still being
// made (for at most a scan's time, so a fill cut off halfway doesn't hold a place for a day).
async function poolCount(client: PrismaClient, now: Date): Promise<number> {
  return client.user.count({
    where: {
      id: { startsWith: TRIAL_ID_PREFIX },
      email: { endsWith: READY_EMAIL_END },
      createdAt: { gt: new Date(now.getTime() - TRIAL_POOL_FRESH_HOURS * HOUR_MS) },
      OR: [
        { firstScanDoneAt: { not: null } },
        { createdAt: { gt: new Date(now.getTime() - SCAN_MAX_MINUTES * 60_000) } },
      ],
    },
  });
}

// Makes ready people, one after another, until there are `size`. Returns how many it made. A
// scan that fails takes its person with it, so a broken one is never handed out.
export async function fillTrialPool({
  client = defaultClient,
  now = new Date(),
  size = TRIAL_POOL_SIZE,
}: Options & { size?: number } = {}): Promise<number> {
  if (!trialEnabled()) return 0;
  let made = 0;
  for (let i = 0; i < size; i++) {
    if ((await poolCount(client, now)) >= size) break;
    const id = await createTrialPerson({ client, now, email: readyEmail });
    try {
      const { itemId } = await linkDemoBank(id, { client, now });
      await syncItem(itemId, { client, now, explain: false });
      made += 1;
    } catch (error) {
      await client.user.deleteMany({ where: { id } });
      throw error;
    }
  }
  return made;
}

// Hands out the oldest ready person: their address becomes an ordinary trial one, their day
// starts now, the Terms are accepted (the link says that opening it means agreeing) and a
// session is made for them. Null when none is ready.
export async function claimReadyPerson({
  client = defaultClient,
  now = new Date(),
  userAgent = null,
}: Options & { userAgent?: string | null } = {}): Promise<{
  userId: string;
  sessionToken: string;
  expires: Date;
} | null> {
  // FOR UPDATE SKIP LOCKED: a second visitor at the same moment takes the next one.
  const rows = await client.$queryRaw<{ id: string }[]>`
    UPDATE users
    SET email = id || ${`@${TRIAL_EMAIL_DOMAIN}`}, created_at = ${now}, updated_at = ${now}
    WHERE id = (
      SELECT id FROM users
      WHERE starts_with(id, ${TRIAL_ID_PREFIX})
        AND email LIKE ${`%${READY_EMAIL_END}`}
        AND first_scan_done_at IS NOT NULL
        AND created_at > ${trialCutoff(now)}
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  const userId = rows[0]?.id;
  if (!userId) return null;
  const expires = new Date(now.getTime() + TRIAL_HOURS * HOUR_MS);
  const sessionToken = `${TRIAL_SESSION_PREFIX}${randomBytes(32).toString("hex")}`;
  await Promise.all([
    acceptTerms(userId, { client, now, via: "try_link" }),
    client.session.create({
      data: { sessionToken, userId, expires, userAgent: userAgent?.slice(0, 200) ?? null },
    }),
  ]);
  return { userId, sessionToken, expires };
}

// After the link has answered: the card text from Claude for the person just handed out (as at
// any first scan), the pool topped up again, and finished trials deleted. Never fails.
export async function afterClaim(
  userId: string | null,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  const safely = (step: string, run: () => Promise<unknown>) =>
    run().catch((error) =>
      console.error("After the try link, a step failed", { step, error: String(error) }),
    );
  if (userId) {
    await safely("explain", async () =>
      runJob(await enqueueJob("explain_findings", { userId }, { client }), { client }),
    );
  }
  await safely("fill", () => fillTrialPool({ client }));
  await safely("clean_up", () => cleanUpTrials({ client }));
}
