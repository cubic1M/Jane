import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_BACKGROUND_DAILY_CAP_CENTS } from "@/config/agent-chat";
import { GMAIL_MONTH_SHARE } from "@/config/gmail";
import { KEEP_RATE_LIMIT_PREFIXES, RATE_LIMITS } from "@/config/rate-limits";

// Against a real, migrated Postgres. The counters are the rate limits' own rows.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { dayStartUtc, monthStartUtc } from "@/lib/dates";
import { db } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { systemDb } from "@/lib/system-db";
import { countRead, giveBackRead, readerReady } from "./limits";

// How much of Claude reading mail may use: whether Claude may be asked for a person's mail at all,
// and the counts of what it reads, per person and per sender.

const url = process.env.TEST_DATABASE_URL;
// Years ahead of the real clock: any hit can clear counters more than a day behind it from the
// database the test files share (src/lib/rate-limit.ts), and one of this file's could go mid-test.
const NOW = new Date("2034-11-05T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const system = () => systemDb("Test: looks at and clears this file's own counters");

describe.runIf(url)("the limits on Claude reading mail", () => {
  const people: string[] = [];
  // A month nobody else's test writes the spend of everyone into, cleared after.
  const FAR = new Date("2233-05-10T12:00:00.000Z");

  async function person(): Promise<string> {
    const user = await db.user.create({
      data: { email: `gmail-limits-${randomUUID()}@example.com` },
    });
    people.push(user.id);
    return user.id;
  }

  // This person's counters in their current windows, by key.
  async function counters(userId: string, now = NOW): Promise<Record<string, number>> {
    const rows = await system().rateLimit.findMany({
      where: { key: { endsWith: `:${userId}` } },
      select: { key: true, windowStart: true, count: true },
    });
    const current = rows.filter((row) => {
      const name = row.key.split(":")[0] as keyof typeof RATE_LIMITS;
      const windowMs = (RATE_LIMITS[name]?.windowSeconds ?? 0) * 1000;
      return (
        windowMs > 0 &&
        row.windowStart.getTime() === Math.floor(now.getTime() / windowMs) * windowMs
      );
    });
    return Object.fromEntries(current.map((row) => [row.key, row.count]));
  }

  const ready = (userId: string, now = NOW) => readerReady(userId, { client: db, now });
  const count = (userId: string, sender: string, now = NOW) =>
    countRead(userId, sender, { client: db, now });

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("KILL_CLAUDE", "");
    vi.stubEnv("OPS_SWITCHES", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    // The spend of everyone this month is shared with other test files: far out of their reach.
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (people.length > 0) {
      await system().rateLimit.deleteMany({
        where: { OR: people.map((id) => ({ key: { endsWith: `:${id}` } })) },
      });
    }
    await system().rateLimit.deleteMany({
      where: { key: "chatmonth:total", windowStart: monthStartUtc(FAR) },
    });
    await system().user.deleteMany({ where: { id: { in: people } } });
  });

  describe("whether Claude may be asked for a person's mail", () => {
    it("may, for a person who has used nothing", async () => {
      expect(await ready(await person())).toEqual({ ok: true });
    });

    it("may not while Claude is off: no key, or KILL_CLAUDE", async () => {
      const userId = await person();
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      expect(await ready(userId)).toEqual({ ok: false, why: "off" });
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("KILL_CLAUDE", "1");
      expect(await ready(userId)).toEqual({ ok: false, why: "off" });
    });

    it("may not for anyone once the month's spend for all of Claude reaches mail's share of the cap", async () => {
      const userId = await person();
      vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000");
      const share = 1000 * GMAIL_MONTH_SHARE * 100;
      const month = { key: "chatmonth:total", windowStart: monthStartUtc(FAR) };
      await system().rateLimit.create({ data: { ...month, count: share - 1 } });
      expect(await ready(userId, FAR)).toEqual({ ok: true });
      await system().rateLimit.update({
        where: { key_windowStart: month },
        data: { count: share },
      });
      expect(await ready(userId, FAR)).toEqual({ ok: false, why: "everyone" });
      // Another person is stopped the same way: it is everyone's.
      expect(await ready(await person(), FAR)).toEqual({ ok: false, why: "everyone" });
    });

    it("may not for a person whose own Claude allowance for the day is used up", async () => {
      const userId = await person();
      await system().rateLimit.create({
        data: {
          key: `claudebg:${userId}`,
          windowStart: dayStartUtc(NOW),
          count: CLAUDE_BACKGROUND_DAILY_CAP_CENTS * 100,
        },
      });
      expect(await ready(userId)).toEqual({ ok: false, why: "person" });
      expect(await ready(await person())).toEqual({ ok: true });
    });

    it.each([
      ["gmailReads", RATE_LIMITS.gmailReads.limit],
      ["gmailReadsMonth", RATE_LIMITS.gmailReadsMonth.limit],
    ] as const)(
      "may not once the person's %s is used up, and may one short of it",
      async (name, limit) => {
        const userId = await person();
        await hit(name, userId, { client: db, now: NOW, by: limit - 1 });
        expect(await ready(userId)).toEqual({ ok: true });
        await hit(name, userId, { client: db, now: NOW });
        expect(await ready(userId)).toEqual({ ok: false, why: "person" });
      },
    );
  });

  describe("counting the emails Claude reads", () => {
    it("counts each one for the sender, the person's day and the person's 30 days", async () => {
      const userId = await person();
      expect(await count(userId, "northwind-power.example")).toBe("ok");
      expect(await count(userId, "northwind-power.example")).toBe("ok");
      expect(await count(userId, "acme.example")).toBe("ok");
      const counts = await counters(userId);
      expect(counts[`gmailReads:${userId}`]).toBe(3);
      expect(counts[`gmailReadsMonth:${userId}`]).toBe(3);
      const senders = Object.entries(counts).filter(([key]) => key.startsWith("gmailSenderReads:"));
      expect(senders.map(([, n]) => n).sort()).toEqual([1, 2]);
    });

    it("skips a sender's 16th email of the day, counts nothing for it, and still reads another sender's", async () => {
      const userId = await person();
      const limit = RATE_LIMITS.gmailSenderReads.limit;
      for (let n = 0; n < limit; n++) expect(await count(userId, "flood.example")).toBe("ok");
      expect(await count(userId, "flood.example")).toBe("sender_limit");
      expect(await count(userId, "flood.example")).toBe("sender_limit");
      expect(await count(userId, "acme.example")).toBe("ok");
      const counts = await counters(userId);
      expect(counts[`gmailReads:${userId}`]).toBe(limit + 1);
      const flood = Object.entries(counts).find(([, n]) => n === limit);
      expect(flood?.[0]).toMatch(/^gmailSenderReads:/);
    });

    it("stops at the person's day, keeping nothing for the email it refused", async () => {
      const userId = await person();
      const limit = RATE_LIMITS.gmailReads.limit;
      await hit("gmailReads", userId, { client: db, now: NOW, by: limit });
      expect(await count(userId, "acme.example")).toBe("person_limit");
      const counts = await counters(userId);
      expect(counts[`gmailReads:${userId}`]).toBe(limit);
      expect(counts[`gmailReadsMonth:${userId}`] ?? 0).toBe(0);
      // The sender's count was given back: nothing of it is left for an email not read.
      const senders = Object.entries(counts).filter(([key]) => key.startsWith("gmailSenderReads:"));
      expect(senders.every(([, n]) => n === 0)).toBe(true);
    });

    it("stops at the person's 30 days, giving back the day and the sender", async () => {
      const userId = await person();
      const limit = RATE_LIMITS.gmailReadsMonth.limit;
      await hit("gmailReadsMonth", userId, { client: db, now: NOW, by: limit });
      expect(await count(userId, "acme.example")).toBe("person_limit");
      const counts = await counters(userId);
      expect(counts[`gmailReadsMonth:${userId}`]).toBe(limit);
      expect(counts[`gmailReads:${userId}`]).toBe(0);
      const senders = Object.entries(counts).filter(([key]) => key.startsWith("gmailSenderReads:"));
      expect(senders.every(([, n]) => n === 0)).toBe(true);
    });

    it("starts the day and the sender again the next day, while the 30 days carry on", async () => {
      const userId = await person();
      const limit = RATE_LIMITS.gmailSenderReads.limit;
      for (let n = 0; n < limit; n++) await count(userId, "flood.example");
      expect(await count(userId, "flood.example")).toBe("sender_limit");
      const tomorrow = new Date(NOW.getTime() + DAY_MS);
      expect(await count(userId, "flood.example", tomorrow)).toBe("ok");
      const counts = await counters(userId, tomorrow);
      expect(counts[`gmailReads:${userId}`]).toBe(1);
      expect(counts[`gmailReadsMonth:${userId}`]).toBe(limit + 1);
    });

    it("gives back all three when Claude couldn't be asked after all", async () => {
      const userId = await person();
      await count(userId, "acme.example");
      await count(userId, "acme.example");
      await giveBackRead(userId, "acme.example", { client: db, now: NOW });
      const counts = await counters(userId);
      expect(counts[`gmailReads:${userId}`]).toBe(1);
      expect(counts[`gmailReadsMonth:${userId}`]).toBe(1);
      const senders = Object.entries(counts).filter(([key]) => key.startsWith("gmailSenderReads:"));
      expect(senders.map(([, n]) => n)).toEqual([1]);
    });
  });

  describe("the counters' keys", () => {
    it("never name the sender's domain, and all end with the person's id, so deleting the account clears them", async () => {
      const userId = await person();
      await count(userId, "northwind-power.example");
      const keys = Object.keys(await counters(userId));
      expect(keys).toHaveLength(3);
      for (const key of keys) {
        expect(key).not.toMatch(/northwind|power|example/i);
        expect(key.endsWith(`:${userId}`)).toBe(true);
      }
    });

    it("keep the 30 days through the daily clean-up, under the name it keeps", async () => {
      const userId = await person();
      await count(userId, "acme.example");
      const month = `gmailReadsMonth:${userId}`;
      expect(Object.keys(await counters(userId))).toContain(month);
      expect(KEEP_RATE_LIMIT_PREFIXES.some((prefix) => month.startsWith(prefix))).toBe(true);
    });
  });
});
