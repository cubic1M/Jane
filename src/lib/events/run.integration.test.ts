import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  SYSTEM_ACTOR: { type: "system", id: null },
}));

import { EVENT_HOLD_DAYS, EVENT_TILT_BY_LEVEL } from "@/config/events";
import { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import type { Bar } from "@/lib/market/types";
import { loadPaperView, startPaperAccount } from "@/lib/paper/account";
import type { PaperPrices } from "@/lib/paper/prices";
import type { Fetcher } from "./gdelt";
import { EventsError, collectEvents, runEventOverlay, setEventsOverlay } from "./run";

// The events overlay with the paper account, against a real, migrated Postgres, on made-up closes:
// it does nothing until switched on, then on the first close after an event is known it tilts
// the account with paper trades (simulated only) and logs each with its event; it catches up a
// missed day, undoes the tilt after its holding time or at its stop, never acts on an event
// before it was known, and never runs for a real account. The daily job stores events from
// recorded feed responses. No network call.

const url = process.env.TEST_DATABASE_URL;
// Tuesday 2026-10-20, after the close.
const NOW = new Date("2026-10-20T22:30:00Z");

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

describe.runIf(url)("the events overlay on the paper account", () => {
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
    await client.marketEvent.deleteMany({});
  });
  afterAll(async () => {
    await client.marketEvent.deleteMany({});
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  const startedOn = async (prices = fakePrices()) => {
    const id = await person("demo");
    await startPaperAccount(id, 1_000_000, {
      client,
      now: new Date("2026-10-12T21:30:00Z"),
      prices,
    });
    return id;
  };

  it("does nothing until it is switched on", async () => {
    const id = await startedOn();
    await event({
      key: uniqueKey("gdelt:chip_boom:2026-10-19"),
      type: "chip_boom",
      date: "2026-10-19",
      knownAt: "2026-10-20T00:15:00Z",
    });
    expect((await runEventOverlay(id, { client, now: NOW, prices: fakePrices() })).ran).toBe(false);
    expect(await client.paperEventLog.count({ where: { userId: id } })).toBe(0);
  });

  it("switched on, tilts the account with paper trades on the first close after the event, logged with it", async () => {
    const prices = fakePrices();
    const id = await startedOn(prices);
    await setEventsOverlay(id, true, { client, now: new Date("2026-10-19T15:00:00Z") });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id },
      "paper_events_switched",
      expect.anything(),
      expect.objectContaining({ on: "true" }),
    );
    const key = uniqueKey("gdelt:chip_boom:2026-10-19");
    await event({ key, type: "chip_boom", date: "2026-10-19", knownAt: "2026-10-20T00:15:00Z" });

    const report = await runEventOverlay(id, { client, now: NOW, prices });
    expect(report).toMatchObject({ ran: true, actions: 1 });
    expect(report.trades).toBeGreaterThan(1);

    const logs = await client.paperEventLog.findMany({ where: { userId: id } });
    expect(logs).toEqual([
      expect.objectContaining({
        kind: "enter",
        eventKey: key,
        eventType: "chip_boom",
        ticker: "SMH",
      }),
    ]);
    // Acted at the close of the 20th: the event was known only after the 19th ended.
    expect(logs[0].date.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(logs[0].reason).toContain("A chip boom");

    const view = (await loadPaperView(id, { client }))!;
    const smh = view.positions.find((p) => p.ticker === "SMH")!;
    expect(smh.valueCents / view.valueCents).toBeCloseTo(EVENT_TILT_BY_LEVEL[view.level], 2);
    const eventTrades = view.trades.filter((t) => t.source === "events");
    expect(eventTrades.map((t) => t.id).sort()).toEqual([...logs[0].tradeIds].sort());
    // Simulated money only: every trade is the paper ledger's, with nothing left waiting.
    expect(
      await client.paperSignal.count({ where: { userId: id, source: "events", status: "open" } }),
    ).toBe(0);

    // Running again the same day changes nothing.
    expect((await runEventOverlay(id, { client, now: NOW, prices })).actions).toBe(0);
  });

  it("never acts on an event before it was known", async () => {
    const prices = fakePrices();
    const id = await startedOn(prices);
    await setEventsOverlay(id, true, { client, now: new Date("2026-10-19T15:00:00Z") });
    // Known only after this run.
    await event({
      key: uniqueKey("gdelt:chip_boom:2026-10-20"),
      type: "chip_boom",
      date: "2026-10-20",
      knownAt: "2026-10-21T00:15:00Z",
    });
    await runEventOverlay(id, { client, now: NOW, prices });
    expect(await client.paperEventLog.count({ where: { userId: id } })).toBe(0);
  });

  it("catches up missed closes, each at its own day's price, and undoes the tilt after its holding time", async () => {
    const prices = fakePrices();
    const id = await startedOn(prices);
    await setEventsOverlay(id, true, { client, now: new Date("2026-10-13T15:00:00Z") });
    await event({
      key: uniqueKey("gdelt:chip_boom:2026-10-13"),
      type: "chip_boom",
      date: "2026-10-13",
      knownAt: "2026-10-14T00:15:00Z",
    });
    await runEventOverlay(id, { client, now: new Date("2026-10-14T22:30:00Z"), prices });
    const enter = await client.paperEventLog.findFirstOrThrow({
      where: { userId: id, kind: "enter" },
    });
    expect(enter.date.toISOString().slice(0, 10)).toBe("2026-10-14");
    const bought = await client.paperTrade.findFirstOrThrow({
      where: { userId: id, source: "events", ticker: "SMH", side: "buy" },
    });
    const close = async (date: string) => (await prices.closes("SMH", date, date))[0].closeCents;
    expect(bought.priceCents).toBe(await close("2026-10-14"));

    // No run for three weeks: the next one catches up the missed closes, and the slice comes out
    // at the close of its holding time, at that day's price, not today's.
    await runEventOverlay(id, { client, now: new Date("2026-11-13T22:30:00Z"), prices });
    const exit = await client.paperEventLog.findFirstOrThrow({
      where: { userId: id, kind: "exit" },
    });
    expect(exit.ticker).toBe("SMH");
    const due = exit.date.toISOString().slice(0, 10);
    expect(due).toBe("2026-11-11");
    const sold = await client.paperTrade.findFirstOrThrow({
      where: { userId: id, source: "events", ticker: "SMH", side: "sell" },
    });
    expect(sold.priceCents).toBe(await close(due));
    expect(EVENT_HOLD_DAYS).toBe(20);
    const view = (await loadPaperView(id, { client }))!;
    expect(view.positions.find((p) => p.ticker === "SMH")).toBeUndefined();
  });

  it("gets out at the stop when the fund falls", async () => {
    const drop = (ticker: string, date: string) =>
      ticker === "SMH" && date >= "2026-10-22" ? 0.85 : 1;
    const id = await startedOn(fakePrices());
    await setEventsOverlay(id, true, { client, now: new Date("2026-10-19T15:00:00Z") });
    await event({
      key: uniqueKey("gdelt:chip_boom:2026-10-19"),
      type: "chip_boom",
      date: "2026-10-19",
      knownAt: "2026-10-20T00:15:00Z",
    });
    await runEventOverlay(id, { client, now: NOW, prices: fakePrices(drop) });
    await runEventOverlay(id, {
      client,
      now: new Date("2026-10-22T22:30:00Z"),
      prices: fakePrices(drop),
    });
    const stop = await client.paperEventLog.findFirstOrThrow({
      where: { userId: id, kind: "stop" },
    });
    expect(stop.reason).toContain("hit its stop");
  });

  it("ignores news from before it was switched on", async () => {
    const prices = fakePrices();
    const id = await startedOn(prices);
    await event({
      key: uniqueKey("gdelt:chip_boom:2026-10-05"),
      type: "chip_boom",
      date: "2026-10-05",
      knownAt: "2026-10-06T00:15:00Z",
    });
    await setEventsOverlay(id, true, { client, now: new Date("2026-10-19T15:00:00Z") });
    await runEventOverlay(id, { client, now: NOW, prices });
    expect(await client.paperEventLog.count({ where: { userId: id } })).toBe(0);
  });

  it("never runs for a real account", async () => {
    const id = await person("real");
    await expect(setEventsOverlay(id, true, { client, now: NOW })).rejects.toThrow(EventsError);
    expect((await runEventOverlay(id, { client, now: NOW, prices: fakePrices() })).ran).toBe(false);
  });

  it("stores the day's events from the feeds, once, with the time each became public", async () => {
    const fixture = (name: string) =>
      readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
    // GDELT: a quiet month, then yesterday 4 times the usual coverage of the Middle East query.
    const days = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.parse("2026-09-06T00:00:00Z") + i * 86_400_000);
      return d.toISOString().slice(0, 10).replaceAll("-", "");
    });
    const timeline = (spike: boolean) =>
      JSON.stringify({
        timeline: [
          {
            series: "Article Count",
            data: days.map((d, i) => ({
              date: `${d}T000000Z`,
              value: spike && i === days.length - 1 ? 1_600 : 400,
              norm: 100_000,
            })),
          },
        ],
      });
    const fetcher = vi.fn(async (u: string) => {
      const body = u.includes("gdeltproject")
        ? timeline(u.includes(encodeURIComponent("hormuz")))
        : u.includes("press_monetary")
          ? fixture("fed-monetary.xml")
          : u.includes("monetary20260916a")
            ? fixture("fomc-2026-09-16.html")
            : u.includes("cpi.rss")
              ? fixture("bls-cpi.xml")
              : fixture("eia-today.xml");
      return { ok: true, status: 200, text: async () => body };
    }) as unknown as Fetcher;
    const now = new Date("2026-10-16T22:30:00Z");
    const report = await collectEvents({
      client,
      now,
      fetcher,
      prices: fakePrices(),
      spacingMs: 0,
    });
    expect(report.failed).toEqual([]);
    const stored = await client.marketEvent.findMany({ orderBy: { knownAt: "asc" } });
    expect(stored.map((e) => `${e.source}:${e.type}`)).toEqual(
      expect.arrayContaining(["bls:inflation_hot", "gdelt:me_conflict"]),
    );
    const spike = stored.find((e) => e.type === "me_conflict")!;
    expect(spike.date.toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(spike.knownAt.toISOString()).toBe("2026-10-16T00:15:00.000Z");
    // The September FOMC statement is older than the fresh window: not stored now.
    expect(stored.some((e) => e.source === "fed")).toBe(false);
    // Again: nothing new.
    expect(
      (await collectEvents({ client, now, fetcher, prices: fakePrices(), spacingMs: 0 })).stored,
    ).toBe(0);
  });
});
