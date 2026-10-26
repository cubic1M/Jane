import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  SYSTEM_ACTOR: { type: "system", id: null },
}));

import { PrismaClient } from "@/generated/prisma/client";
import type { Bar } from "@/lib/market/types";
import { loadPaperView, startPaperAccount } from "@/lib/paper/account";
import type { PaperPrices } from "@/lib/paper/prices";
import { runEventOverlay, setEventsOverlay } from "./run";
import { eventUpdates, markEventSeen, revertEventAction } from "./updates";
import { loadEventsView } from "./view";

// The Events box and the trade pop-up's updates, against a real, migrated Postgres, on made-up
// closes: what the overlay would do (off) and did (on), how sure, its record; its own trades shown
// once in the pop-up, with Revert taking them back and closing the slice. A real account gets none.

const url = process.env.TEST_DATABASE_URL;
// Tuesday 2027-10-19, after the close.
const NOW = new Date("2027-10-19T22:30:00Z");

// Weekday closes for any ticker, the same for the same day whatever range is asked for: a steady
// climb from a price set by its name, times `bump`.
const fakePrices = (bump: (ticker: string, date: string) => number = () => 1): PaperPrices => ({
  name: "sample",
  real: false,
  closes: async (ticker: string, from: string, to: string) => {
    const out: Bar[] = [];
    const base = 5_000 + [...ticker].reduce((a, c) => a + c.charCodeAt(0), 0) * 20;
    for (
      let d = Date.parse(`${from}T00:00:00Z`);
      d <= Date.parse(`${to}T00:00:00Z`);
      d += 86_400_000
    ) {
      const day = new Date(d).getUTCDay();
      if (day === 0 || day === 6) continue;
      const date = new Date(d).toISOString().slice(0, 10);
      const n = Math.round(d / 86_400_000) - 20_000;
      out.push({ date, closeCents: Math.round(base * 1.0004 ** n * bump(ticker, date)) });
    }
    return out;
  },
});

// Market events are shared by every test file: this one keeps to 2027, and clears only those.
const ownYear = () => ({
  date: { gte: new Date("2027-01-01T00:00:00Z"), lt: new Date("2028-01-01T00:00:00Z") },
});

describe.runIf(url)("the Events box and its updates", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (bank: "demo" | "real") => {
    const user = await client.user.create({
      data: { email: `events-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `${bank === "demo" ? "demo-" : "item-"}${crypto.randomUUID()}`,
        accessTokenEncrypted: "test-token",
        institutionName: bank === "demo" ? "Demo Bank" : "First Real Bank",
      },
    });
    return user.id;
  };
  const event = async (over: { key: string; type: string; date: string; knownAt: string }) =>
    client.marketEvent.create({
      data: {
        ...over,
        source: "gdelt",
        date: new Date(`${over.date}T00:00:00Z`),
        knownAt: new Date(over.knownAt),
        title: "A chip boom: news coverage 3.1 times its usual level",
        url: null,
        strength: 3.1,
      },
    });
  const keys: string[] = [];
  const uniqueKey = (k: string) => {
    const key = `${k}:${crypto.randomUUID()}`;
    keys.push(key);
    return key;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await client.marketEvent.deleteMany({ where: ownYear() });
  });
  afterAll(async () => {
    await client.marketEvent.deleteMany({ where: ownYear() });
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  const startedOn = async (prices = fakePrices()) => {
    const id = await person("demo");
    await startPaperAccount(id, 1_000_000, {
      client,
      now: new Date("2027-10-11T21:30:00Z"),
      prices,
    });
    return id;
  };

  it("shows in the box what it would do, then what it did, and its update in the pop-up, with Revert", async () => {
    const prices = fakePrices();
    const id = await startedOn(prices);
    const key = uniqueKey("gdelt:chip_boom:2027-10-18");
    await event({ key, type: "chip_boom", date: "2027-10-18", knownAt: "2027-10-19T00:15:00Z" });

    // Off: what it would do, how sure, and its record.
    const off = (await loadEventsView(id, { client, now: NOW }))!;
    expect(off).toMatchObject({ on: false, hasAccount: true });
    expect(off.now).toEqual([
      expect.objectContaining({ key, label: "A chip boom", acting: false }),
    ]);
    expect(off.now[0].plan).toMatch(/^Would tilt \+SMH, /);
    expect(off.now[0].confidence).toBeGreaterThanOrEqual(5);
    expect(off.record).toHaveLength(9);
    expect(off.label).toBe("Demo advice: sample data, not financial advice");

    await setEventsOverlay(id, true, { client, now: new Date("2027-10-18T15:00:00Z") });
    await runEventOverlay(id, { client, now: NOW, prices });
    const on = (await loadEventsView(id, { client, now: NOW }))!;
    expect(on.on).toBe(true);
    expect(on.now[0].plan).toMatch(/^Did: \+SMH/);
    expect(on.open).toEqual([expect.objectContaining({ ticker: "SMH", side: "buy" })]);
    expect(on.recent[0]).toMatchObject({ kind: "enter", ticker: "SMH" });

    // The pop-up's update: once, until OK or Revert.
    const [update] = await eventUpdates(id, { client, now: NOW });
    expect(update.headline).toMatch(/^Events: added \d+(\.\d)?% in SMH$/);
    expect(update.label).toBe("Demo advice: sample data, not financial advice");
    const reverted = await revertEventAction(id, update.id, { client, now: NOW });
    expect(reverted).toEqual({ ok: true });
    expect(await eventUpdates(id, { client, now: NOW })).toEqual([]);
    const view = (await loadPaperView(id, { client }))!;
    expect(view.positions.find((p) => p.ticker === "SMH")).toBeUndefined();
    expect(view.trades.filter((t) => t.source === "events").every((t) => t.reverted)).toBe(true);
    // The slice is closed, so its exit won't trade, and nothing waits in the pop-up.
    expect((await loadEventsView(id, { client, now: NOW }))!.open).toEqual([]);
    expect(
      await client.paperSignal.count({ where: { userId: id, source: "events", status: "open" } }),
    ).toBe(0);
    expect(await markEventSeen(id, update.id, { client, now: NOW })).toEqual({ ok: false });
  });

  it("shows a real account no box", async () => {
    const id = await person("real");
    expect(await loadEventsView(id, { client, now: NOW })).toBeNull();
    expect(await eventUpdates(id, { client, now: NOW })).toEqual([]);
  });
});
