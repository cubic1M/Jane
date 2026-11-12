import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// "Start over" queues the uploads' background work; not needed here.
vi.mock("@/lib/jobs", () => ({ enqueueJob: vi.fn(async () => "job") }));

import { scopedFor } from "@/lib/db-scoped";
import { refreshAfterRemoval } from "@/lib/import/background";
import { startOver } from "@/lib/import/remove";
import { AS_THEY_COME } from "@/lib/jane-agent/preferences";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { linkDemoBank } from "@/lib/plaid/demo";
import { removePlaidItem } from "@/lib/plaid/remove";
import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";
import { freshStartAfter } from "./fresh-start";

// The night debugger's round 217 (11-12), against a real, migrated Postgres: /connect says "try
// the demo bank, remove it anytime". Someone links it, removes it in Settings and links a bank
// again the same day. Jane's messages about the demo bank had used up the day's limit and held
// the same dedupe keys, so the new bank brought 2 cards while 17 suggestions waited. With the
// last bank gone, the next one is a fresh start: the full first set of cards again.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const LATER = new Date(NOW.getTime() + HOUR_MS);

describe.runIf(url)("a bank linked again after the last one was removed", () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  // Linking runs Jane (the sync's own run, then the scan's); the person then opens the chat.
  async function linkAndRun(now: Date) {
    const { itemId } = await linkDemoBank(userId, { client, now });
    // Linked on the test's clock, as in production, so removing it forgets what came after.
    await client.plaidItem.update({ where: { id: itemId }, data: { createdAt: now } });
    await syncItem(itemId, { client, api: plaid, now });
    await scanSuggestions(userId, { client, now });
    await runJaneAgent(userId, { client, now, trigger: "open" });
    return itemId;
  }
  // Jane's own cards (what counts toward the day) posted from then on.
  const cardsSince = (from: Date, to = new Date(8.64e15)) =>
    client.janeMessage.count({
      where: {
        userId,
        kind: { in: ["decision", "heads_up", "done"] },
        createdAt: { gte: from, lt: to },
      },
    });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `fresh-start-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.janePreference.create({
      data: { userId, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("brings the full first set of cards again, the same day, and never doubles them", async () => {
    const firstItem = await linkAndRun(NOW);
    const first = await cardsSince(NOW, LATER);
    expect(first).toBeGreaterThan(2);
    // Run again: everything was said, nothing new.
    expect((await runJaneAgent(userId, { client, now: NOW, trigger: "open" })).posted).toBe(0);
    const db = scopedFor(userId, client);
    expect(await freshStartAfter(db)).toBeNull();

    await removePlaidItem(userId, firstItem, "user_disconnected", { client, api: plaid });
    await refreshAfterRemoval(userId, { client, now: NOW });
    expect(await freshStartAfter(db)).not.toBeNull();
    // The next bank is scanned as a first one.
    expect(
      await client.user.findUnique({
        where: { id: userId },
        select: { firstDetectionAt: true, firstScanDoneAt: true },
      }),
    ).toEqual({ firstDetectionAt: null, firstScanDoneAt: null });

    await linkAndRun(LATER);
    expect(await cardsSince(LATER)).toBe(first);
    // Each card once: brought back as new, never a second copy of the same suggestion.
    const keys = await db.janeMessages.findMany({ select: { dedupeKey: true } });
    expect(new Set(keys.map((k) => k.dedupeKey)).size).toBe(keys.length);
    // And from here on the day counts as usual.
    expect((await runJaneAgent(userId, { client, now: LATER, trigger: "open" })).posted).toBe(0);
  }, 240_000);

  it("is no fresh start while a file is still there, and is one once it goes too", async () => {
    await client.account.create({
      data: { userId, source: "csv", name: "Chase Checking", type: "depository" },
    });
    const db = scopedFor(userId, client);
    const before = await freshStartAfter(db);
    const itemId = await linkAndRun(new Date(LATER.getTime() + HOUR_MS));
    await removePlaidItem(userId, itemId, "user_disconnected", { client, api: plaid });
    expect(await freshStartAfter(db)).toEqual(before);
    expect(
      (await client.user.findUnique({ where: { id: userId }, select: { firstScanDoneAt: true } }))
        ?.firstScanDoneAt,
    ).not.toBeNull();

    // "Start over" on the uploads: nothing is left, so what Jane said up to now is behind it.
    await startOver(db, { client });
    const newest = await client.janeMessage.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    expect(await freshStartAfter(db)).toEqual(newest?.createdAt);
    expect(
      await client.user.findUnique({
        where: { id: userId },
        select: { firstDetectionAt: true, firstScanDoneAt: true },
      }),
    ).toEqual({ firstDetectionAt: null, firstScanDoneAt: null });
  }, 240_000);
});
