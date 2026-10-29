import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { TERMS_VERSION } from "@/config/legal";
import {
  TRIAL_EMAIL_DOMAIN,
  TRIAL_HOURS,
  TRIAL_POOL_FRESH_HOURS,
  TRIAL_POOL_SIZE,
} from "@/config/trial";
import { logAudit } from "@/lib/audit";
import { scopedFor } from "@/lib/db-scoped";
import { isTrialEmail } from "@/lib/trial-ids";
import { claimReadyPerson, fillTrialPool } from "./trial-pool";

// The /try link's sample people made ahead, against a real, migrated Postgres: made and scanned
// with no session and no Claude card text, handed out once each (two visitors at the same
// moment get two people), and deleted on time like every trial person.

const url = process.env.TEST_DATABASE_URL;
// Years after every other file's sample people (the same database runs them at once), so their
// clean-ups never reach this file's. It never runs the clean-up itself (that would reach theirs):
// cleanUpTrials deletes by createdAt (src/lib/trial.integration.test.ts), checked here instead.
const NOW = new Date("2031-03-10T15:00:00Z");
const HOUR = 60 * 60 * 1000;
const later = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const READY = `+ready@${TRIAL_EMAIL_DOMAIN}`;

describe.runIf(url)("sample people kept ready for /try", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  // Every person this file made: the ready ones, also once handed out.
  const mine = new Set<string>();
  const fill = async (now: Date, size: number) => {
    const made = await fillTrialPool({ client, now, size });
    const ready = await client.user.findMany({
      where: { email: { endsWith: READY } },
      select: { id: true },
    });
    for (const { id } of ready) mine.add(id);
    return made;
  };
  const clearMine = async () => {
    await client.user.deleteMany({
      where: { OR: [{ id: { in: [...mine] } }, { email: { endsWith: READY } }] },
    });
    mine.clear();
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(clearMine);
  afterEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TRY_JANE", "");
  });
  afterAll(async () => {
    await clearMine();
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("makes ready people up to the pool's size, scanned, with no session or Terms yet", async () => {
    expect(await fill(NOW, 2)).toBe(2);
    // Full already: nothing more.
    expect(await fill(NOW, 2)).toBe(0);
    const ready = await client.user.findMany({ where: { id: { in: [...mine] } } });
    expect(ready).toHaveLength(2);
    for (const person of ready) {
      expect(person.id).toMatch(/^trial_[0-9a-f]{24}$/);
      expect(person.email).toBe(`${person.id}${READY}`);
      // Still a trial address: never emailed.
      expect(isTrialEmail(person.email)).toBe(true);
      expect(person.firstScanDoneAt).not.toBeNull();
      expect(person.termsVersion).toBeNull();
      expect(await client.session.count({ where: { userId: person.id } })).toBe(0);
      expect(await scopedFor(person.id, client).findings.count()).toBeGreaterThan(0);
      // No card text from Claude until someone is given them.
      expect(
        await client.job.count({
          where: { kind: "explain_findings", payload: { path: ["userId"], equals: person.id } },
        }),
      ).toBe(0);
    }
  });

  it("hands out the oldest ready person once, signed in for a day from now, Terms accepted", async () => {
    await fill(NOW, 1);
    const [readyId] = mine;
    const at = later(3);
    const claimed = await claimReadyPerson({ client, now: at, userAgent: "Phone" });
    expect(claimed).toMatchObject({ userId: readyId, expires: later(3 + TRIAL_HOURS) });
    expect(claimed!.sessionToken).toMatch(/^trial_[0-9a-f]{64}$/);
    const user = await client.user.findUniqueOrThrow({ where: { id: readyId } });
    expect(user).toMatchObject({
      email: `${readyId}@${TRIAL_EMAIL_DOMAIN}`,
      createdAt: at,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: at,
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: readyId },
      "terms_accepted",
      { type: "user", id: readyId },
      { version: TERMS_VERSION, via: "try_link" },
    );
    expect(
      await client.session.findUniqueOrThrow({ where: { sessionToken: claimed!.sessionToken } }),
    ).toMatchObject({ userId: readyId, userAgent: "Phone" });
    // Handed out: nobody else gets them.
    expect(await claimReadyPerson({ client, now: at })).toBeNull();
    // Their day starts when they were handed out (createdAt: at, above): the clean-up deletes
    // them TRIAL_HOURS after that, as for every trial person.
  });

  it("gives visitors at the same moment different people", async () => {
    await fill(NOW, 2);
    const claims = await Promise.all(
      [1, 2, 3].map(() => claimReadyPerson({ client, now: later(1) })),
    );
    const ids = claims.filter((c) => c !== null).map((c) => c.userId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(mine);
  });

  it("never hands out one still being scanned, or a person someone already has", async () => {
    // Made by "Try it with sample data": an ordinary trial address.
    const landing = `trial_${randomBytes(12).toString("hex")}`;
    // Made ahead, scan not finished.
    const scanning = `trial_${randomBytes(12).toString("hex")}`;
    mine.add(landing).add(scanning);
    await client.user.createMany({
      data: [
        {
          id: landing,
          email: `${landing}@${TRIAL_EMAIL_DOMAIN}`,
          createdAt: NOW,
          firstScanDoneAt: NOW,
        },
        { id: scanning, email: `${scanning}${READY}`, createdAt: NOW },
      ],
    });
    expect(await claimReadyPerson({ client, now: later(0.1) })).toBeNull();
  });

  it("tops up with fresh people before the old ones go, and never hands out one past its day", async () => {
    await fill(NOW, 1);
    const [old] = mine;
    // A day's top-up later: yesterday's person isn't fresh, so a new one is made beside it.
    const next = later(TRIAL_POOL_FRESH_HOURS + 1);
    expect(await fill(next, 1)).toBe(1);
    expect(mine.size).toBe(2);
    const fresh = [...mine].find((id) => id !== old)!;
    // The old one is handed out first, while it lasts; the fresh one waits, and keeps the time
    // it was made, so the clean-up deletes it TRIAL_HOURS after that if nobody takes it.
    expect((await claimReadyPerson({ client, now: next }))?.userId).toBe(old);
    expect(await client.user.findUniqueOrThrow({ where: { id: fresh } })).toMatchObject({
      email: `${fresh}${READY}`,
      createdAt: next,
    });
    // Past its day, an old one is never handed out.
    expect(
      await claimReadyPerson({ client, now: later(TRIAL_POOL_FRESH_HOURS + 1 + TRIAL_HOURS) }),
    ).toBeNull();
  });

  it("makes no one where trying Jane isn't offered", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRY_JANE", "");
    expect(await fill(NOW, TRIAL_POOL_SIZE)).toBe(0);
    expect(mine.size).toBe(0);
  });
});
