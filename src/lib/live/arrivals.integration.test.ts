import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type FindingType } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { TRIAL_ID_PREFIX } from "@/config/trial";
import { linkDemoBank } from "@/lib/plaid/demo";
import { firstDelivery, syncFromWebhook } from "@/lib/plaid/webhooks";
import { syncItem } from "@/lib/plaid/sync";
import { recordArrivals, whatSetOffSync } from "./arrivals";

// Jane's 24/7 engine, step one, against a real, migrated Postgres: findings a change created are
// recorded once with what set them off and how long it took, and the best one that clears the bar
// is asked about in the chat at once, at most once a day, never at night, to a sample person or on
// the demo bank.

const url = process.env.TEST_DATABASE_URL;
// 10am in Los Angeles.
const NOW = new Date("2026-11-12T18:00:00Z");
const HOUR = 60 * 60 * 1000;

describe.runIf(url)("new findings told the moment they're found", () => {
  let client: PrismaClient;
  const made: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person(id?: string) {
    const user = await client.user.create({
      data: {
        ...(id ? { id } : {}),
        email: `live-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    made.push(user.id);
    await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    return user.id;
  }

  async function finding(
    userId: string,
    key: string,
    annualSavingsCents: number | null,
    confidence: "low" | "medium" | "high" = "high",
    type: FindingType = "subscription_review",
  ) {
    await client.finding.create({
      data: {
        userId,
        type,
        key,
        title: `Review your ${key} subscription`,
        annualSavingsCents,
        amountCents: annualSavingsCents,
        confidence,
        evidence: { merchant: key },
      },
    });
    return { type, key };
  }

  const arrivals = (userId: string) =>
    client.findingArrival.findMany({
      where: { userId },
      include: { finding: { select: { key: true } } },
      orderBy: { createdAt: "asc" },
    });
  const posted = (userId: string) =>
    client.janeMessage.findMany({ where: { userId }, select: { dedupeKey: true, kind: true } });
  // The notification the chat sends for it (src/lib/jane-agent/notify.ts), as a job.
  const notifications = (userId: string) =>
    client.job.count({ where: { kind: "chat_notify", payload: { equals: { userId } } } });

  it("records each new finding once, and asks about the biggest one now", async () => {
    const userId = await person();
    const created = [
      await finding(userId, "gym", 48_000),
      await finding(userId, "music", 13_000),
      await finding(userId, "news", 2_000),
    ];
    const triggerAt = new Date(NOW.getTime() - 4_000);
    const first = await recordArrivals(userId, created, {
      client,
      now: NOW,
      trigger: "webhook",
      triggerAt,
      foundAt: NOW,
    });
    const rows = await arrivals(userId);
    expect(rows.map((r) => [r.finding.key, r.notice])).toEqual(
      expect.arrayContaining([
        ["gym", "posted"],
        ["music", "today_used"],
        ["news", "below_bar"],
      ]),
    );
    expect(rows.every((r) => r.trigger === "webhook" && r.latencyMs === 4_000)).toBe(true);
    const gym = rows.find((r) => r.finding.key === "gym");
    expect(first.posted).toBe(gym?.findingId);
    // The brain's own key, so tomorrow's brief never asks it again.
    expect(await posted(userId)).toEqual([
      { dedupeKey: `findings:${gym?.findingId}`, kind: "decision" },
    ]);
    expect(await notifications(userId)).toBe(1);

    // The same webhook again (or a second scan of the same change) adds nothing.
    const again = await recordArrivals(userId, created, {
      client,
      now: new Date(NOW.getTime() + 60_000),
      trigger: "webhook",
      triggerAt,
    });
    expect(again).toEqual({ recorded: 0, posted: null });
    expect(await arrivals(userId)).toHaveLength(3);
    expect(await posted(userId)).toHaveLength(1);
    expect(await notifications(userId)).toBe(1);
  });

  // CI 11-12: a scan run on a set clock (tests, replays) against the real clock gave a latency past
  // the int column, and every such recording failed. It's capped, and recording never throws.
  it("records a finding whose trigger was long ago, without overflowing", async () => {
    const userId = await person();
    const longAgo = new Date(NOW.getTime() - 40 * 24 * HOUR);
    await recordArrivals(userId, [await finding(userId, "old", 2_000)], {
      client,
      now: NOW,
      trigger: "sync",
      triggerAt: longAgo,
      foundAt: NOW,
    });
    expect((await arrivals(userId)).map((r) => r.latencyMs)).toEqual([2_147_483_647]);
  });

  it("tells at most one a day", async () => {
    const userId = await person();
    await recordArrivals(userId, [await finding(userId, "phone", 30_000)], {
      client,
      now: NOW,
      trigger: "webhook",
      triggerAt: NOW,
    });
    const later = new Date(NOW.getTime() + 3 * HOUR);
    await recordArrivals(userId, [await finding(userId, "cloud", 90_000)], {
      client,
      now: later,
      trigger: "webhook",
      triggerAt: later,
    });
    expect((await arrivals(userId)).map((r) => r.notice)).toEqual(["posted", "today_used"]);
    // A day on, there's room again.
    const tomorrow = new Date(NOW.getTime() + 25 * HOUR);
    await recordArrivals(userId, [await finding(userId, "video", 20_000)], {
      client,
      now: tomorrow,
      trigger: "webhook",
      triggerAt: tomorrow,
    });
    expect((await arrivals(userId)).at(-1)?.notice).toBe("posted");
  });

  it("keeps below the bar to the brief: a small saving, or one detection is unsure of", async () => {
    const userId = await person();
    await recordArrivals(
      userId,
      [await finding(userId, "small", 5_000), await finding(userId, "unsure", 80_000, "low")],
      { client, now: NOW, trigger: "webhook", triggerAt: NOW },
    );
    expect((await arrivals(userId)).map((r) => r.notice)).toEqual(["below_bar", "below_bar"]);
    expect(await posted(userId)).toEqual([]);
  });

  it("says nothing at night, during a first scan, or to a sample person", async () => {
    const night = await person();
    // 2am in Los Angeles.
    const twoAm = new Date("2026-11-12T10:00:00Z");
    await recordArrivals(night, [await finding(night, "gym", 48_000)], {
      client,
      now: twoAm,
      trigger: "webhook",
      triggerAt: twoAm,
    });
    expect((await arrivals(night)).map((r) => r.notice)).toEqual(["quiet_hours"]);

    const firstScan = await person();
    await recordArrivals(firstScan, [await finding(firstScan, "gym", 48_000)], {
      client,
      now: NOW,
      trigger: "sync",
      triggerAt: NOW,
      firstScan: true,
    });
    expect((await arrivals(firstScan)).map((r) => r.notice)).toEqual(["first_scan"]);

    const sample = await person(`${TRIAL_ID_PREFIX}${crypto.randomUUID()}`);
    await recordArrivals(sample, [await finding(sample, "gym", 48_000)], {
      client,
      now: NOW,
      trigger: "webhook",
      triggerAt: NOW,
    });
    expect((await arrivals(sample)).map((r) => r.notice)).toEqual(["sample"]);
    expect([
      ...(await posted(night)),
      ...(await posted(firstScan)),
      ...(await posted(sample)),
    ]).toEqual([]);
  });

  it("finds what a bank's webhook set off, through the real sync, and times it", async () => {
    const user = await client.user.create({
      data: { email: `live-demo-${crypto.randomUUID()}@example.com` },
    });
    made.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    // The first scan's findings are the first brief's, not a notification's.
    expect((await arrivals(user.id)).every((r) => r.notice === "first_scan")).toBe(true);

    // A finding the bank's new data brings back: gone now, found again by the webhook's sync.
    const gone = await client.finding.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { annualSavingsCents: { sort: "desc", nulls: "last" } },
    });
    await client.finding.delete({ where: { id: gone.id } });
    const item = await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } });
    const later = new Date(NOW.getTime() + 2 * HOUR);
    const body = {
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: item.plaidItemId,
    };
    const raw = JSON.stringify(body);
    expect(await firstDelivery(raw, body, { client, now: later })).toBe(true);
    const syncAt = new Date(later.getTime() + 1_500);
    await syncFromWebhook(itemId, {
      client,
      now: syncAt,
      sync: (id) => syncItem(id, { client, api: plaid, now: syncAt }),
    });
    const back = (await arrivals(user.id)).filter(
      (r) => r.finding.key === gone.key && r.findingId !== gone.id,
    );
    const again = await client.finding.findFirstOrThrow({
      where: { userId: user.id, type: gone.type, key: gone.key },
    });
    expect(back.map((r) => r.findingId)).toContain(again.id);
    expect(back.filter((r) => r.findingId === again.id)).toHaveLength(1);
    expect(back.find((r) => r.findingId === again.id)).toMatchObject({
      trigger: "webhook",
      notice: "demo",
    });
    expect(back.find((r) => r.findingId === again.id)?.triggerAt.toISOString()).toBe(
      later.toISOString(),
    );
    // The same delivery again is a repeat, and nothing is recorded twice.
    expect(await firstDelivery(raw, body, { client, now: later })).toBe(false);
    expect(
      await whatSetOffSync(item.plaidItemId, {
        client,
        startedAt: new Date(later.getTime() + 2 * HOUR),
      }),
    ).toEqual({ trigger: "sync", triggerAt: new Date(later.getTime() + 2 * HOUR) });
  });
});
