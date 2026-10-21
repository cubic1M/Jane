import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

// The slow sector work after detection: what the chat must not wait for. It records what the
// person could already see when it started.
const { seenBySlowWork } = vi.hoisted(() => ({ seenBySlowWork: [] as number[] }));
vi.mock("@/lib/insurance/daily", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/insurance/daily")>();
  return {
    ...original,
    insuranceAfterSync: vi.fn(
      async (userId: string, options: Parameters<typeof original.insuranceAfterSync>[1]) => {
        seenBySlowWork.push(
          await options!.client!.janeMessage.count({ where: { userId, kind: "decision" } }),
        );
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
import { scanInProgress, scanReady } from "@/lib/scan";
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

    await syncItem(trial.itemId, { client, now: NOW, progressive: true });
    // The findings were posted before the slow sector work started.
    expect(seenBySlowWork[0]).toBeGreaterThan(0);
    expect(await scanReady(trial.userId, { client })).toBe(true);
    expect(await scanInProgress(trial.userId, { client })).toBe(false);
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: trial.userId } })).firstScanDoneAt,
    ).not.toBeNull();
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
      select: { body: true, kind: true },
    });
    expect(messages[0].body).toBe(SCANNING_HELLO);
    // The day's first agenda leads with what the scan found, with its percentage.
    const agenda = messages.find((m) => /what I'd do first/.test(m.body));
    expect(agenda, messages.map((m) => m.body.slice(0, 30)).join(" | ")).toBeDefined();
    expect(agenda!.body).toMatch(/% sure|not sure/);
    expect(messages.findIndex((m) => m === agenda)).toBeGreaterThan(0);
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
