import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/error-alerts", () => ({ alertError: vi.fn(async () => true) }));

import { OFFER_SEEDS, OFFERS_UNREADABLE_READS, type SourceSpec } from "@/config/offers";
import { alertError } from "@/lib/error-alerts";
import { liveOffers, refreshSource, seedOffers } from "./catalog";
import type { Fetcher } from "./fetch";

// The offers catalog given bad readings (test pass 11-13): a figure out of range, a jump, an empty
// page, a 403 and a robots.txt refusal. A bad figure is never shown and the founders hear once,
// however many runs keep reading it; a page that can't be read keeps the last good figure until
// its time is up, and the founders hear once when it hasn't been read for a while. Its own made-up
// source and keys, so the catalog's other test file can run beside it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-13T18:00:00Z");
const HOUR = 3_600_000;
const TAG = `bad${Date.now().toString(36)}`;
const KEY = `savings.${TAG}`;
const PAGE = `https://bank-${TAG}.example/savings`;

const source: SourceSpec = {
  key: TAG,
  how: "page",
  url: PAGE,
  sourceUrl: PAGE,
  everyMinutes: 6 * 60,
  showHours: 72,
  offers: [
    {
      key: KEY,
      kind: "savings_apy",
      provider: "Test Bank",
      name: "Test Savings",
      plausible: [50, 800],
      maxJump: 100,
      signUpUrl: PAGE,
    },
  ],
};

// One answer for the page and one for robots.txt.
function web(page: { status?: number; body?: string }, robots = ""): Fetcher {
  return async (address) =>
    new URL(address).pathname === "/robots.txt"
      ? new Response(robots, { status: 200 })
      : new Response(page.body ?? "", { status: page.status ?? 200 });
}
const apy = (value: string) => web({ body: `<h1>Savings</h1><p>${value}% APY</p>` });

describe.runIf(url)("the offers catalog, given bad readings", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(async () => {
    await clear();
    vi.mocked(alertError).mockClear();
  });
  afterAll(async () => {
    await clear();
    await client.$disconnect();
  });
  const clear = async () => {
    await client.marketOfferEvent.deleteMany({ where: { source: TAG } });
    await client.marketOffer.deleteMany({ where: { key: KEY } });
  };
  const read = (fetcher: Fetcher, at = NOW) =>
    refreshSource(source, { client, now: at, fetcher, extract: null });
  const shown = async (at = NOW) =>
    (await liveOffers({ client, now: at })).filter((o) => o.key === KEY);
  const alerts = (kind: string) =>
    vi.mocked(alertError).mock.calls.filter(([e]) => e.message.startsWith(kind)).length;

  it("never shows a figure out of range, and tells the founders once however often it's read", async () => {
    // The very first reading is impossible: no row is made, and three hourly runs alert once.
    for (let run = 0; run < 3; run++) {
      const result = await read(apy("41.00"), new Date(NOW.getTime() + run * HOUR));
      expect(result.quarantined).toEqual([KEY]);
    }
    expect(await shown()).toEqual([]);
    expect(alerts("OfferQuarantined")).toBe(1);
    // A believable reading puts it on screen; a later impossible one takes it off, and tells again.
    await read(apy("3.70"), new Date(NOW.getTime() + 4 * HOUR));
    expect((await shown(new Date(NOW.getTime() + 4 * HOUR))).map((o) => o.valueBps)).toEqual([370]);
    await read(apy("0.01"), new Date(NOW.getTime() + 5 * HOUR));
    await read(apy("0.01"), new Date(NOW.getTime() + 6 * HOUR));
    expect(await shown(new Date(NOW.getTime() + 6 * HOUR))).toEqual([]);
    expect(alerts("OfferQuarantined")).toBe(2);
  });

  it("holds back a jump from the last real reading, once, until a believable one comes back", async () => {
    await read(apy("3.70"));
    await read(apy("6.20"), new Date(NOW.getTime() + HOUR));
    await read(apy("6.20"), new Date(NOW.getTime() + 2 * HOUR));
    expect(await client.marketOffer.findUnique({ where: { key: KEY } })).toMatchObject({
      status: "quarantined",
      valueBps: 370,
    });
    expect(await shown(new Date(NOW.getTime() + 2 * HOUR))).toEqual([]);
    expect(alerts("OfferQuarantined")).toBe(1);
    await read(apy("3.75"), new Date(NOW.getTime() + 3 * HOUR));
    expect((await shown(new Date(NOW.getTime() + 3 * HOUR))).map((o) => o.valueBps)).toEqual([375]);
  });

  it("keeps the last good figure through an empty page, a 403 or a robots refusal, never a guess", async () => {
    await read(apy("3.70"));
    const empty = await read(
      web({ body: "<html><body></body></html>" }),
      new Date(NOW.getTime() + HOUR),
    );
    expect(empty).toMatchObject({ missing: [KEY], quarantined: [], changed: [] });
    const forbidden = await read(web({ status: 403 }), new Date(NOW.getTime() + 2 * HOUR));
    expect(forbidden).toMatchObject({ failed: "http_403", missing: [KEY] });
    const refused = await read(
      web({ body: "<p>3.70% APY</p>" }, "User-agent: *\nDisallow: /savings"),
      new Date(NOW.getTime() + 3 * HOUR),
    );
    expect(refused).toMatchObject({ failed: "robots", missing: [KEY] });
    // Still the 3.70% read at NOW, shown until its own time runs out, and no alert yet.
    expect((await shown(new Date(NOW.getTime() + 3 * HOUR))).map((o) => o.valueBps)).toEqual([370]);
    expect(await shown(new Date(NOW.getTime() + source.showHours * HOUR + 1))).toEqual([]);
    expect(alerts("OfferQuarantined") + alerts("OfferUnreadable")).toBe(0);
  });

  it("tells the founders once when a figure on screen hasn't been read for a while", async () => {
    await read(apy("3.70"));
    const allowance = OFFERS_UNREADABLE_READS * source.everyMinutes * 60_000;
    const late = NOW.getTime() + allowance;
    // Failing inside the allowance: nothing said.
    await read(web({ status: 403 }), new Date(late - HOUR));
    expect(alerts("OfferUnreadable")).toBe(0);
    // Past it: once, however many more runs fail.
    for (let run = 1; run <= 3; run++)
      await read(web({ status: 403 }), new Date(late + run * HOUR));
    expect(alerts("OfferUnreadable")).toBe(1);
    expect(vi.mocked(alertError).mock.calls[0]?.[0].message).toContain("http_403");
    // Read again, then lost again: a new outage, told again.
    const back = late + 4 * HOUR;
    await read(apy("3.70"), new Date(back));
    await read(web({ body: "" }), new Date(back + allowance + HOUR));
    expect(alerts("OfferUnreadable")).toBe(2);
  });
});

// The hand-kept figures stop on 2026-11-15 (jane-24-7.md): each seed shows until 45 days after its
// as-of date, then never.
describe.runIf(url)("the hand-kept seeds' cut-off", () => {
  let client: PrismaClient;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await seedOffers({ client });
  });
  afterAll(() => client.$disconnect());

  it("shows the seeds up to the end of 11-14 UTC and none from 11-15", async () => {
    const seeds = OFFER_SEEDS.map((s) => s.key);
    const seedRows = async (at: Date) =>
      (await liveOffers({ client, now: at }))
        .filter((o) => seeds.includes(o.key) && o.extractedBy === "seed")
        .map((o) => o.key);
    const stillSeeds = await client.marketOffer.findMany({
      where: { key: { in: seeds }, extractedBy: "seed" },
      select: { key: true, expiresAt: true },
    });
    // Each seed row still a seed (another file may have read some live) runs out at 11-15 00:00Z.
    for (const row of stillSeeds) {
      expect(row.expiresAt.toISOString(), row.key).toBe("2026-11-15T00:00:00.000Z");
    }
    if (stillSeeds.length > 0) {
      expect((await seedRows(new Date("2026-11-14T23:59:00Z"))).length).toBe(stillSeeds.length);
    }
    expect(await seedRows(new Date("2026-11-15T00:00:01Z"))).toEqual([]);
  });
});
