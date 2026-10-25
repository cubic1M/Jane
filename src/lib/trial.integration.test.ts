import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { TERMS_VERSION } from "@/config/legal";
import { syncItem } from "@/lib/plaid/sync";
import { TRIAL_HOURS } from "@/config/trial";
import { adviceMode } from "@/lib/advice-mode";
import { mailMode } from "@/lib/agent/mail";
import { scopedFor } from "@/lib/db-scoped";
import { sendEmail } from "@/lib/email";
import { runRetention } from "@/lib/retention";
import { callMode } from "@/lib/voice/provider";
import { PEOPLE } from "@/config/people";
import { profileOf } from "@/lib/investments/profile";
import { riskLevelOf } from "@/planning/investor-profile";
import { TrialError, cleanUpTrials, startTrial, trialEnabled } from "./trial";

// Spec step 138 against a real, migrated Postgres: a visitor gets their own sample person
// with the demo bank and demo advice, signed in for a day; two visitors never see each
// other's data; nothing contacts a company or is counted; and trial people are deleted on
// time, never anyone else.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const HOUR = 60 * 60 * 1000;

describe.runIf(url)("trying Jane with sample data", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TRY_JANE", "");
    vi.stubEnv("DEMO_BANK", "");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const start = async (now = NOW) => {
    const trial = await startTrial({ client, now, userAgent: "Test browser" });
    created.push(trial.userId);
    return trial;
  };

  it("makes a sample person with the demo bank, signed in for a day", async () => {
    const { userId, sessionToken, expires } = await start();
    expect(userId).toMatch(/^trial_[0-9a-f]{24}$/);
    expect(expires.getTime() - NOW.getTime()).toBe(TRIAL_HOURS * HOUR);
    const session = await client.session.findUniqueOrThrow({ where: { sessionToken } });
    expect(session).toMatchObject({ userId, expires, userAgent: "Test browser" });
    // The Terms the visitor ticked to try it.
    expect(await client.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: NOW,
    });
    const db = scopedFor(userId, client);
    expect(await db.accounts.count()).toBeGreaterThan(0);
    expect(await db.findings.count()).toBeGreaterThan(0);
    // Jane has already said hello in the chat.
    expect(await db.janeMessages.count()).toBeGreaterThan(0);
    // Demo advice, even in production.
    vi.stubEnv("NODE_ENV", "production");
    expect(await adviceMode(userId, { client })).toBe(true);
  });

  it("with defer, does only the minimum and leaves the first sync to the caller", async () => {
    const started = await startTrial({ client, now: NOW, defer: true });
    created.push(started.userId);
    const db = scopedFor(started.userId, client);
    // The user, the session and the linked demo item are there; nothing has been scanned.
    expect(await client.session.count({ where: { sessionToken: started.sessionToken } })).toBe(1);
    expect(await db.plaidItems.count()).toBe(1);
    expect(await db.accounts.count()).toBe(0);
    expect(await db.findings.count()).toBe(0);
    // The caller's sync then does the rest.
    await syncItem(started.itemId, { client, now: NOW });
    expect(await db.accounts.count()).toBeGreaterThan(0);
    expect(await db.findings.count()).toBeGreaterThan(0);
  });

  it("gives each sample person their investor profile, as if they had answered the four", async () => {
    // Gap audit: without it every sample person's portfolio review, rebalance plan, goal
    // buckets and retirement plan said the investor profile wasn't finished.
    for (const person of PEOPLE) {
      const trial = await startTrial({ client, now: NOW, defer: true, person: person.id });
      created.push(trial.userId);
      const profile = await profileOf(trial.userId, { client });
      expect(profile, person.id).toMatchObject({
        age: person.investor.age,
        ageOn: "2026-10-18",
        horizon: person.investor.horizon,
        dropReaction: person.investor.dropReaction,
        goals: [...person.investor.goals],
        answeredAt: NOW,
      });
      expect(riskLevelOf(profile), person.id).not.toBeNull();
    }
  });

  it("leaves the profile to the person on the plain demo bank", async () => {
    // Anyone else answers the four in the chat (the investments integration test, step 129).
    const plain = await start();
    expect((await profileOf(plain.userId, { client })).answeredAt).toBeNull();
  });

  it("gives each visitor their own person, who sees only their own data", async () => {
    const a = await start();
    const b = await start();
    expect(a.userId).not.toBe(b.userId);
    const aAccounts = await scopedFor(a.userId, client).accounts.findMany({ select: { id: true } });
    const bAccounts = await scopedFor(b.userId, client).accounts.findMany({ select: { id: true } });
    expect(aAccounts.some((x) => bAccounts.some((y) => y.id === x.id))).toBe(false);
    // A's session is A's alone.
    const session = await client.session.findUniqueOrThrow({
      where: { sessionToken: a.sessionToken },
    });
    expect(session.userId).toBe(a.userId);
  });

  it("never contacts a company or emails anyone, and is never counted", async () => {
    const { userId } = await start();
    vi.stubEnv("NODE_ENV", "production");
    expect(mailMode(userId)).toBe("simulated");
    expect(callMode(userId)).toBe("simulated");
    expect(mailMode("real-person")).toBe("off");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "jane@example.com");
    const fetch = vi.spyOn(globalThis, "fetch");
    await sendEmail({ to: `${userId}@try.jane.invalid`, subject: "s", html: "h", text: "t" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await client.analyticsEvent.count({ where: { userId } })).toBe(0);
  });

  it("deletes trial people once their day is up, and never anyone else", async () => {
    const old = await start(new Date(NOW.getTime() - (TRIAL_HOURS + 1) * HOUR));
    const real = await client.user.create({
      data: {
        email: `real-${crypto.randomUUID()}@example.com`,
        createdAt: new Date(NOW.getTime() - 48 * HOUR),
      },
    });
    created.push(real.id);
    expect(await cleanUpTrials({ client, now: NOW })).toBe(1);
    expect(await client.user.findUnique({ where: { id: old.userId } })).toBeNull();
    // Everything they had went with them.
    expect(await client.session.count({ where: { userId: old.userId } })).toBe(0);
    expect(await client.account.count({ where: { userId: old.userId } })).toBe(0);
    expect(await client.user.findUnique({ where: { id: real.id } })).not.toBeNull();

    // Each new trial cleans up too.
    const late = await start(new Date(NOW.getTime() - (TRIAL_HOURS + 1) * HOUR));
    const fresh = await start();
    expect(await client.user.findUnique({ where: { id: late.userId } })).toBeNull();
    expect(await client.user.findUnique({ where: { id: fresh.userId } })).not.toBeNull();
    expect(await client.user.findUnique({ where: { id: real.id } })).not.toBeNull();

    // The daily retention run does the same.
    const later = new Date(NOW.getTime() + (TRIAL_HOURS + 1) * HOUR);
    const removed = await runRetention({ client, now: later });
    expect(removed.trialPeople).toBeGreaterThanOrEqual(1);
    expect(await client.user.findUnique({ where: { id: fresh.userId } })).toBeNull();
  });

  it("is offered only where the demo bank is, and in production only with TRY_JANE=1", async () => {
    expect(trialEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(trialEnabled()).toBe(false);
    vi.stubEnv("DEMO_BANK", "1");
    expect(trialEnabled()).toBe(false);
    vi.stubEnv("TRY_JANE", "1");
    expect(trialEnabled()).toBe(true);
    vi.stubEnv("DEMO_BANK", "");
    await expect(startTrial({ client, now: NOW })).rejects.toBeInstanceOf(TrialError);
  });
});
