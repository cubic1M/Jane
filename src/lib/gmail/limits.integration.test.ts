import { createHash, randomInt, randomUUID } from "node:crypto";
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
  // A month nobody else's test writes the spend of everyone into, and this run's own: a row a run
  // killed half way left behind, or one a run going on at the same time writes, is in another month.
  // Cleared after.
  const FAR = new Date(Date.UTC(2300 + randomInt(700), randomInt(12), 10, 12));
  const monthRow = { key: "chatmonth:total", windowStart: monthStartUtc(FAR) };
  // Sets that month's spend for all of Claude, whether or not its row is there already.
  const spent = (count: number) =>
    system().rateLimit.upsert({
      where: { key_windowStart: monthRow },
      create: { ...monthRow, count },
      update: { count },
    });

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
    vi.stubEnv("AUTH_SECRET", "site-secret-one");
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
    await system().rateLimit.deleteMany({ where: monthRow });
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
      // The month's row as a run killed before its clean-up leaves it: this run sets its own spend
      // over it rather than failing on a row that is there already.
      await spent(share);
      await spent(share - 1);
      expect(await ready(userId, FAR)).toEqual({ ok: true });
      await spent(share);
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

  describe("a sender's counter", () => {
    // What anyone holding the database could make from a list of domains: the plain SHA-256 of each,
    // alone or in the shapes these keys have had or could have, whole or cut as a key cuts it.
    const plainHashes = (userId: string, domain: string): string[] =>
      [domain, `sender:${domain}`, `gmail_sender:${domain}`, `gmail_sender:${userId}:${domain}`]
        .map((text) => createHash("sha256").update(text).digest("hex"))
        .flatMap((hex) => [hex, hex.slice(0, 32)]);

    // This person's sender counters: the keyed part of each key, and its count.
    async function senders(userId: string): Promise<[string, number][]> {
      return Object.entries(await counters(userId)).flatMap(([key, n]): [string, number][] => {
        const [name, keyed] = key.split(":");
        return name === "gmailSenderReads" ? [[keyed, n]] : [];
      });
    }

    it("is keyed with the site's secret: no plain SHA-256 of the sender's domain finds it", async () => {
      const userId = await person();
      await count(userId, "clinic.example");
      const found = await senders(userId);
      expect(found).toHaveLength(1);
      const [[keyed]] = found;
      expect(keyed).toMatch(/^[0-9a-f]{32}$/);
      expect(plainHashes(userId, "clinic.example")).not.toContain(keyed);
    });

    it("depends on the site's secret, and is the same counter each time under one secret", async () => {
      const userId = await person();
      await count(userId, "clinic.example");
      await count(userId, "clinic.example");
      vi.stubEnv("AUTH_SECRET", "site-secret-two");
      await count(userId, "clinic.example");
      expect((await senders(userId)).map(([, n]) => n).sort()).toEqual([1, 2]);
    });

    it("differs between two people for one sender, so their counters can't be matched", async () => {
      const one = await person();
      const two = await person();
      await count(one, "clinic.example");
      await count(two, "clinic.example");
      const [[keyedOne]] = await senders(one);
      const [[keyedTwo]] = await senders(two);
      expect(keyedOne).not.toBe(keyedTwo);
    });

    it("without AUTH_SECRET, or with an empty one, is still no plain hash, and still holds the sender's limit", async () => {
      const userId = await person();
      const limit = RATE_LIMITS.gmailSenderReads.limit;
      vi.stubEnv("AUTH_SECRET", undefined);
      for (let n = 1; n < limit; n++) expect(await count(userId, "clinic.example")).toBe("ok");
      // An empty secret is none: the same counter, never one keyed with an empty key.
      vi.stubEnv("AUTH_SECRET", "");
      expect(await count(userId, "clinic.example")).toBe("ok");
      expect(await count(userId, "clinic.example")).toBe("sender_limit");
      const found = await senders(userId);
      expect(found.map(([, n]) => n)).toEqual([limit]);
      const [[keyed]] = found;
      expect(plainHashes(userId, "clinic.example")).not.toContain(keyed);
    });

    it("without AUTH_SECRET, is keyed with one made when the module loads, never one written down", async () => {
      const userId = await person();
      vi.stubEnv("AUTH_SECRET", undefined);
      expect(await count(userId, "clinic.example")).toBe("ok");
      // A fresh load stands in for a new process. A key written in the source, or an empty one,
      // would be the same in it, and anyone could hash a list of domains with that key.
      vi.resetModules();
      const fresh = await import("./limits");
      expect(await fresh.countRead(userId, "clinic.example", { client: db, now: NOW })).toBe("ok");
      expect((await senders(userId)).map(([, n]) => n)).toEqual([1, 1]);
    });
  });
});
