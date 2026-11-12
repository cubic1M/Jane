import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/error-alerts", () => ({ alertError: vi.fn(async () => true) }));

import { OFFER_SOURCES, OFFERS_CLAUDE_MONTHLY_CALLS, type SourceSpec } from "@/config/offers";
import { usableOptions } from "@/lib/compare";
import { alertError } from "@/lib/error-alerts";
import {
  liveOffers,
  recheckPlanPrices,
  refreshDueOffers,
  refreshSource,
  seedOffers,
} from "./catalog";
import type { Fetcher } from "./fetch";

// The offers catalog against a real, migrated Postgres. The catalog's tables are shared, so each run
// clears them first; nothing else uses them in this file's database.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-12T18:00:00Z");
const HOUR = 3_600_000;

const source = (key: string) => OFFER_SOURCES.find((s) => s.key === key) as SourceSpec;
const barclays = source("barclays.savings");
const spotify = source("spotify.plans");

// A fake web: robots.txt allows everything unless told otherwise, and each page says what it's given.
function web(pages: Record<string, string>, robots = ""): Fetcher {
  return async (address) => {
    const at = new URL(address);
    if (at.pathname === "/robots.txt") return new Response(robots, { status: 200 });
    const body = pages[`${at.origin}${at.pathname}`];
    return body === undefined
      ? new Response("", { status: 404 })
      : new Response(body, { status: 200 });
  };
}
const barclaysPage = (apy: string) => ({
  "https://banking.barclaysus.com/online-savings.html": `<h1>Online Savings</h1><p>${apy}% APY</p>`,
});

describe.runIf(url)("the offers catalog", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(async () => {
    await client.marketOfferEvent.deleteMany({});
    await client.marketOffer.deleteMany({});
    vi.mocked(alertError).mockClear();
  });
  afterAll(async () => {
    await client.marketOfferEvent.deleteMany({});
    await client.marketOffer.deleteMany({});
    await client.$disconnect();
  });

  const row = (key: string) => client.marketOffer.findUnique({ where: { key } });

  it("saves a bank's rate read from its own page, with where and when, and shows it until its time is up", async () => {
    const result = await refreshSource(barclays, {
      client,
      now: NOW,
      fetcher: web(barclaysPage("3.65")),
      extract: null,
    });
    expect(result.changed).toEqual(["savings.barclays"]);
    expect(await row("savings.barclays")).toMatchObject({
      valueBps: 365,
      status: "live",
      extractedBy: "parser",
      sourceUrl: "https://banking.barclaysus.com/online-savings.html",
      checkedAt: NOW,
      expiresAt: new Date(NOW.getTime() + barclays.showHours * HOUR),
    });
    expect((await liveOffers({ client, now: NOW })).map((o) => o.key)).toEqual([
      "savings.barclays",
    ]);
    // Past its time it's never shown, though the row stays.
    const later = new Date(NOW.getTime() + barclays.showHours * HOUR + 1);
    expect(await liveOffers({ client, now: later })).toEqual([]);
    // The same reading again moves nothing.
    const again = await refreshSource(barclays, {
      client,
      now: new Date(NOW.getTime() + HOUR),
      fetcher: web(barclaysPage("3.65")),
      extract: null,
    });
    expect(again.changed).toEqual([]);
  });

  it("is the pick for idle cash, as an option Jane can compare", async () => {
    await refreshSource(barclays, {
      client,
      now: NOW,
      fetcher: web(barclaysPage("3.65")),
      extract: null,
    });
    const options = await usableOptions({ client, now: NOW });
    expect(options.find((o) => o.id === "offer:savings.barclays")).toMatchObject({
      kind: "savings",
      provider: "Barclays",
      apyBps: 365,
      checkedAt: "2026-11-12",
      checkedTime: NOW.toISOString(),
    });
  });

  it("quarantines a reading that jumps or can't be true, tells the founders once, and stops showing it", async () => {
    await refreshSource(barclays, {
      client,
      now: NOW,
      fetcher: web(barclaysPage("3.65")),
      extract: null,
    });
    const jumped = await refreshSource(barclays, {
      client,
      now: new Date(NOW.getTime() + HOUR),
      fetcher: web(barclaysPage("9.65")),
      extract: null,
    });
    expect(jumped.quarantined).toEqual(["savings.barclays"]);
    expect(await row("savings.barclays")).toMatchObject({ status: "quarantined", valueBps: 365 });
    expect(await liveOffers({ client, now: NOW })).toEqual([]);
    expect(alertError).toHaveBeenCalledTimes(1);
    // Still wrong an hour later: quarantined still, and the founders aren't told again.
    await refreshSource(barclays, {
      client,
      now: new Date(NOW.getTime() + 2 * HOUR),
      fetcher: web(barclaysPage("9.65")),
      extract: null,
    });
    expect(alertError).toHaveBeenCalledTimes(1);

    const implausible = await refreshSource(spotify, {
      client,
      now: NOW,
      fetcher: web({
        "https://www.spotify.com/us/premium/":
          "<p>Individual $512.99 / month</p><p>Student $6.99 / month</p>",
      }),
      extract: null,
    });
    expect(implausible.quarantined).toEqual(["plan.spotify.individual"]);
    expect(implausible.changed).toEqual(["plan.spotify.student"]);
  });

  it("asks Claude only when the page changed and the reader missed, under the month's cap", async () => {
    const extract = vi.fn(async () => ({ "savings.barclays": 370 }));
    const moved = {
      "https://banking.barclaysus.com/online-savings.html":
        "<p>Our rate: 3.70 percent annual yield</p>",
    };
    const first = await refreshSource(barclays, { client, now: NOW, fetcher: web(moved), extract });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(first.changed).toEqual(["savings.barclays"]);
    expect(await row("savings.barclays")).toMatchObject({ valueBps: 370, extractedBy: "claude" });
    // The same page again: Claude isn't asked twice about a page it already read.
    await refreshSource(barclays, {
      client,
      now: new Date(NOW.getTime() + HOUR),
      fetcher: web(moved),
      extract,
    });
    expect(extract).toHaveBeenCalledTimes(1);

    // The month's cap used up: a changed page isn't sent.
    await client.marketOfferEvent.createMany({
      data: Array.from({ length: OFFERS_CLAUDE_MONTHLY_CALLS }, () => ({
        source: "x",
        kind: "claude",
        createdAt: NOW,
      })),
    });
    const capped = await refreshSource(barclays, {
      client,
      now: new Date(NOW.getTime() + 2 * HOUR),
      fetcher: web({
        "https://banking.barclaysus.com/online-savings.html": "<p>New design, rate inside</p>",
      }),
      extract,
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(capped.missing).toEqual(["savings.barclays"]);
  });

  it("never reads a page robots.txt keeps robots away from", async () => {
    const result = await refreshSource(barclays, {
      client,
      now: NOW,
      fetcher: web(barclaysPage("3.65"), "User-agent: *\nDisallow: /online-savings.html"),
      extract: null,
    });
    expect(result.missing).toEqual(["savings.barclays"]);
    expect(await row("savings.barclays")).toBeNull();
    const failed = await client.marketOfferEvent.findFirst({
      where: { source: barclays.key, kind: "failed" },
    });
    expect(failed?.detail).toEqual({ reason: "robots" });
  });

  it("starts from the hand-kept figures, each shown only until its time is up", async () => {
    expect(await seedOffers({ client })).toBeGreaterThan(0);
    expect(await seedOffers({ client })).toBe(0);
    expect(await row("plan.spotify.student")).toMatchObject({
      valueCents: 599,
      extractedBy: "seed",
    });
    expect(await row("savings.reference")).toMatchObject({ valueBps: 400 });
    expect(
      (await liveOffers({ client, now: new Date("2026-11-10T00:00:00Z") })).length,
    ).toBeGreaterThan(0);
    expect(await liveOffers({ client, now: new Date("2026-12-01T00:00:00Z") })).toEqual([]);
    // A real reading replaces a seed even when it's far from it (the seed was only an estimate).
    await refreshSource(spotify, {
      client,
      now: NOW,
      fetcher: web({
        "https://www.spotify.com/us/premium/":
          "<p>Individual $12.99 / month</p><p>Student $6.99 / month</p>",
      }),
      extract: null,
    });
    expect(await row("plan.spotify.student")).toMatchObject({
      valueCents: 699,
      extractedBy: "parser",
      status: "live",
    });
  });

  it("reads each source on its own cadence, and a person's changed charge rechecks old prices", async () => {
    const pages = {
      ...barclaysPage("3.65"),
      "https://www.spotify.com/us/premium/":
        "<p>Individual $12.99 / month</p><p>Student $6.99 / month</p>",
    };
    const fetcher = vi.fn(web(pages));
    await refreshDueOffers({ client, now: NOW, fetcher, extract: null });
    const firstCalls = fetcher.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    // An hour on, nothing is due.
    await refreshDueOffers({ client, now: new Date(NOW.getTime() + HOUR), fetcher, extract: null });
    expect(fetcher.mock.calls.length).toBe(firstCalls);

    // Fresh prices aren't read again for a person's charge; old ones are.
    expect(
      await recheckPlanPrices("spotify", {
        client,
        now: new Date(NOW.getTime() + HOUR),
        fetcher,
        extract: null,
      }),
    ).toBeNull();
    const rechecked = await recheckPlanPrices("spotify", {
      client,
      now: new Date(NOW.getTime() + 7 * HOUR),
      fetcher,
      extract: null,
    });
    expect(rechecked?.source).toBe("spotify.plans");
    expect(await recheckPlanPrices("no_such_service", { client, now: NOW, fetcher })).toBeNull();
  });
});
