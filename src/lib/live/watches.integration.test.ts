import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type FindingType } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { TRIAL_ID_PREFIX } from "@/config/trial";
import { matchOffers, refreshWatches } from "./watches";

// Reverse matching against a real, migrated Postgres: each scan leaves the person's watches, and an
// offer that moves reaches only the people it now helps, each once per offer and value. The offers
// here are made up (their own keys and service), so other files' catalog rows don't matter.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-12T18:00:00Z");
const SERVICE = `watchfm${crypto
  .randomUUID()
  .replace(/[^a-f]/g, "")
  .slice(0, 8)}`;
const BANK = `savings.watch_bank_${Date.now()}`;

describe.runIf(url)("reverse matching", () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.marketOffer.deleteMany({
      where: { key: { in: [BANK, `plan.${SERVICE}.student`] } },
    });
    await client.$disconnect();
  });

  async function person(findings: { type: FindingType; evidence: object }[], id?: string) {
    const user = await client.user.create({
      data: { ...(id ? { id } : {}), email: `watch-${crypto.randomUUID()}@example.com` },
    });
    made.push(user.id);
    for (const [i, f] of findings.entries()) {
      await client.finding.create({
        data: {
          userId: user.id,
          type: f.type,
          key: `k${i}`,
          title: "t",
          confidence: "high",
          evidence: f.evidence,
        },
      });
    }
    await refreshWatches(user.id, { client });
    return user.id;
  }
  async function offer(
    key: string,
    values: { valueBps?: number; valueCents?: number },
    extra = {},
  ) {
    const data = {
      source: "test",
      kind: key.startsWith("plan.") ? "plan_price" : "savings_apy",
      provider: "Test",
      name: key,
      ...values,
      sourceUrl: "https://example.com/",
      signUpUrl: "https://example.com/",
      checkedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      extractedBy: "parser",
      ...extra,
    };
    await client.marketOffer.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  const watchesOf = (userId: string) =>
    client.offerWatch.findMany({ where: { userId }, orderBy: { target: "asc" } });

  it("keeps each person's watches from their scan, and none for a sample person", async () => {
    const saver = await person([
      { type: "idle_cash", evidence: { excessCents: 2_000_000, assumedCurrentRateBps: 50 } },
      { type: "subscription_review", evidence: { merchant: SERVICE, lastAmountCents: 1_299 } },
    ]);
    expect((await watchesOf(saver)).map((w) => [w.target, w.idleCents ?? w.monthlyCents])).toEqual([
      [`plan:${SERVICE}`, 1_299],
      ["savings", 2_000_000],
    ]);
    // The idle cash gone from the next scan: its watch goes too.
    await client.finding.deleteMany({ where: { userId: saver, type: "idle_cash" } });
    await refreshWatches(saver, { client });
    expect((await watchesOf(saver)).map((w) => w.target)).toEqual([`plan:${SERVICE}`]);

    const sample = await person(
      [{ type: "idle_cash", evidence: { excessCents: 2_000_000, assumedCurrentRateBps: 50 } }],
      `${TRIAL_ID_PREFIX}${crypto.randomUUID()}`,
    );
    expect(await watchesOf(sample)).toEqual([]);
  });

  it("scans again only the people an offer now helps, once per offer and value", async () => {
    const idle = await person([
      { type: "idle_cash", evidence: { excessCents: 2_000_000, assumedCurrentRateBps: 50 } },
    ]);
    // $300 above the cushion: even at the new rate it earns less than a switch is worth.
    const small = await person([
      { type: "idle_cash", evidence: { excessCents: 30_000, assumedCurrentRateBps: 50 } },
    ]);
    const fullPrice = await person([
      { type: "price_increase", evidence: { merchant: SERVICE, lastAmountCents: 1_299 } },
    ]);
    const onStudent = await person([
      { type: "subscription_review", evidence: { merchant: SERVICE, lastAmountCents: 699 } },
    ]);
    await offer(BANK, { valueBps: 365 });
    await offer(`plan.${SERVICE}.student`, { valueCents: 699 }, { merchantKey: SERVICE });

    const scanned: string[] = [];
    const scan = vi.fn(async (userId: string) => {
      scanned.push(userId);
    });
    await matchOffers({ client, now: NOW, scan });
    expect(scanned).toEqual(expect.arrayContaining([idle, fullPrice]));
    expect(scanned).not.toContain(small);
    expect(scanned).not.toContain(onStudent);

    // The same offers again: nobody twice.
    scanned.length = 0;
    await matchOffers({ client, now: NOW, scan });
    expect(scanned.filter((id) => [idle, small, fullPrice, onStudent].includes(id))).toEqual([]);

    // The bank's rate moves: the idle saver again, nobody else of ours.
    await offer(BANK, { valueBps: 380 });
    await matchOffers({ client, now: NOW, scan });
    expect(scanned.filter((id) => [idle, small, fullPrice, onStudent].includes(id))).toEqual([
      idle,
    ]);

    // A quarantined or expired offer helps no one.
    scanned.length = 0;
    await offer(BANK, { valueBps: 395 }, { status: "quarantined" });
    await matchOffers({ client, now: NOW, scan });
    expect(scanned).not.toContain(idle);
  });

  it("runs a real rescan for someone an offer helps, without failing", async () => {
    const idle = await person([
      { type: "idle_cash", evidence: { excessCents: 2_000_000, assumedCurrentRateBps: 50 } },
    ]);
    await offer(BANK, { valueBps: 410 }, { status: "live" });
    const result = await matchOffers({ client, now: NOW });
    expect(result.matched).toBeGreaterThan(0);
    // Matched for this offer and value: the watch says so (or went with a finding the scan dropped).
    const watch = await client.offerWatch.findFirst({ where: { userId: idle, target: "savings" } });
    expect(watch === null || watch.lastMatch === `${BANK}:410`).toBe(true);
  });
});
