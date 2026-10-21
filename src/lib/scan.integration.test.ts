import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

// The slow sector work after detection: what the chat must not wait for. It records what the
// person could already see when it started.
const { seenBySlowWork, savedBySlowWork, failSector } = vi.hoisted(() => ({
  seenBySlowWork: [] as number[],
  savedBySlowWork: [] as number[],
  failSector: { on: false },
}));
vi.mock("@/lib/insurance/daily", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/insurance/daily")>();
  return {
    ...original,
    insuranceAfterSync: vi.fn(
      async (userId: string, options: Parameters<typeof original.insuranceAfterSync>[1]) => {
        savedBySlowWork.push(
          await options!.client!.janePreference.count({
            where: { userId, kind: "system", key: "snapshot" },
          }),
        );
        seenBySlowWork.push(
          await options!.client!.janeMessage.count({ where: { userId, kind: "decision" } }),
        );
        if (failSector.on) throw new Error("a sector failed");
        return original.insuranceAfterSync(userId, options);
      },
    ),
  };
});

// The first scan's suggestions, slowed down (as on a slow database): what had been posted when
// they started and finished, to show the brief waits for them and the hello is already there.
const { atScan } = vi.hoisted(() => ({
  atScan: [] as { bodies: string[]; at: "start" | "end" }[],
}));
vi.mock("@/lib/suggestions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/suggestions")>();
  return {
    ...original,
    scanSuggestions: vi.fn(
      async (userId: string, options: Parameters<typeof original.scanSuggestions>[1]) => {
        const read = async () =>
          (
            await options!.client!.janeMessage.findMany({
              where: { userId },
              select: { body: true },
            })
          ).map((m) => m.body);
        atScan.push({ bodies: await read(), at: "start" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        const out = await original.scanSuggestions(userId, options);
        atScan.push({ bodies: await read(), at: "end" });
        return out;
      },
    ),
  };
});

import { SCANNING_HELLO } from "@/config/scan";
import { openChat } from "@/lib/jane-agent/open";
import { scanInProgress, scanProgress, scanReady } from "@/lib/scan";
import { startTrial } from "@/lib/trial";
import { syncItem } from "@/lib/plaid/sync";

// The chat opens early during the first scan (the sample person's too): once the accounts and
// transactions are in it shows at once with Jane saying she's still looking, before the slow
// sectors have finished, and her findings are posted before that slow work starts.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("the chat opens during the first scan", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is not ready, then in progress, then done, with the chat open throughout", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true });
    created.push(trial.userId);
    // Linked but nothing scanned yet: not ready, and still scanning.
    expect(await scanReady(trial.userId, { client })).toBe(false);
    expect(await scanInProgress(trial.userId, { client })).toBe(true);
    seenBySlowWork.length = 0;
    savedBySlowWork.length = 0;

    await syncItem(trial.itemId, { client, now: NOW, progressive: true });
    // The findings were posted before the slow sector work started.
    expect(seenBySlowWork[0]).toBeGreaterThan(0);
    // And the snapshot was already saved, so the first chat question finds it instead of
    // building it (13 seconds on live).
    expect(savedBySlowWork[0]).toBe(1);
    expect(await scanReady(trial.userId, { client })).toBe(true);
    expect(await scanInProgress(trial.userId, { client })).toBe(false);
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: trial.userId } })).firstScanDoneAt,
    ).not.toBeNull();
  });

  it("reports each stage of the first scan as it really happens", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true });
    created.push(trial.userId);
    const before = await scanProgress(trial.userId, { client });
    expect(before).toMatchObject({ transactions: false, months: 0, detection: false, done: false });

    await syncItem(trial.itemId, { client, now: NOW, progressive: true });
    const after = await scanProgress(trial.userId, { client });
    expect(after).toMatchObject({
      accounts: true,
      transactions: true,
      detection: true,
      done: true,
    });
    expect(after.months).toBeGreaterThanOrEqual(6);
    expect(after.suggestions).toBe(true);
  });

  it("says it is still looking first, and the brief waits for the suggestions", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true, person: "debt" });
    created.push(trial.userId);
    atScan.length = 0;
    await syncItem(trial.itemId, { client, now: NOW, progressive: true });
    // While the (slow) scan ran, only "still looking" had been said: no brief, no findings.
    const start = atScan.find((s) => s.at === "start")!;
    expect(start.bodies).toEqual([SCANNING_HELLO]);
    // Then the first thing Jane posted came after the hello, and it leads with a suggestion.
    const messages = await client.janeMessage.findMany({
      where: { userId: trial.userId },
      orderBy: { createdAt: "asc" },
      select: { body: true, kind: true, createdAt: true },
    });
    // Strictly first: its time is before everything else Jane posted in the sync (no tie).
    expect(messages[0].body).toBe(SCANNING_HELLO);
    expect(messages[0].createdAt.getTime()).toBeLessThan(messages[1].createdAt.getTime());
    // Exactly: "still looking", then Jane's welcome, then the agenda that leads with the scan's
    // suggestions and their percentage.
    const at = (test: (body: string) => boolean) => messages.findIndex((m) => test(m.body));
    const looking = at((b) => b === SCANNING_HELLO);
    const welcome = at((b) => /^Hi, I'm Jane\. I look at your money/.test(b));
    const agenda = at((b) => /what I'd do first/.test(b));
    expect(looking, messages.map((m) => m.body.slice(0, 30)).join(" | ")).toBe(0);
    expect(welcome).toBeGreaterThan(looking);
    expect(agenda).toBeGreaterThan(welcome);
    expect(messages[agenda].body).toMatch(/% sure|not sure/);
  });

  it("posts the first brief even when the scan runs in the night's quiet hours", async () => {
    const night = new Date("2026-10-17T03:00:00Z");
    const trial = await startTrial({ client, now: night, defer: true, person: "debt" });
    created.push(trial.userId);
    await syncItem(trial.itemId, { client, now: night, progressive: true });
    const bodies = (
      await client.janeMessage.findMany({ where: { userId: trial.userId }, select: { body: true } })
    ).map((m) => m.body);
    expect(bodies.some((b) => /what I'd do first/.test(b))).toBe(true);
  });

  it("still finishes the scan and says its piece when a sector's work fails", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true, person: "retiree" });
    created.push(trial.userId);
    failSector.on = true;
    try {
      await syncItem(trial.itemId, { client, now: NOW, progressive: true });
    } finally {
      failSector.on = false;
    }
    // The scan ended, and Jane's agenda came with what she found: not "still going through your
    // accounts" for good.
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: trial.userId } })).firstScanDoneAt,
    ).not.toBeNull();
    const bodies = (
      await client.janeMessage.findMany({ where: { userId: trial.userId }, select: { body: true } })
    ).map((m) => m.body);
    expect(bodies.some((b) => /what I'd do first/.test(b))).toBe(true);
  });

  it("opens at once with 'still looking', without running the whole agent, while it scans", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true });
    created.push(trial.userId);
    // Accounts and transactions are in (as /scanning waits for) but the scan isn't done.
    await syncItem(trial.itemId, { client, now: NOW });
    await client.user.update({ where: { id: trial.userId }, data: { firstScanDoneAt: null } });
    await client.janeMessage.deleteMany({ where: { userId: trial.userId } });
    expect(await scanInProgress(trial.userId, { client })).toBe(true);

    const chat = (await openChat(trial.userId, { client }))!;
    expect(chat.scanning).toBe(true);
    expect(chat.messages.map((m) => m.body)).toEqual([SCANNING_HELLO]);
    // Nothing else ran: no findings, no brief.
    expect(await client.janeMessage.count({ where: { userId: trial.userId } })).toBe(1);
    // Opening again says it once.
    await openChat(trial.userId, { client });
    expect(await client.janeMessage.count({ where: { userId: trial.userId } })).toBe(1);

    // When the scan finishes the chat is normal again: the hello comes, then the findings.
    await client.user.update({ where: { id: trial.userId }, data: { firstScanDoneAt: NOW } });
    const done = (await openChat(trial.userId, { client }))!;
    expect(done.scanning).toBe(false);
  });

  it("is over after a few minutes whether or not it finished, and for people with no bank link", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true });
    created.push(trial.userId);
    expect(
      await scanInProgress(trial.userId, { client, now: new Date(Date.now() + 10 * 60_000) }),
    ).toBe(false);
    const plain = await client.user.create({
      data: { email: `scan-${crypto.randomUUID()}@example.com` },
    });
    created.push(plain.id);
    expect(await scanInProgress(plain.id, { client })).toBe(false);
  });
});
