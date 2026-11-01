import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "@/config/events";
import { knownBy } from "@/planning/event-detect";
import {
  cpiEvents,
  eiaEvents,
  feedEvents,
  fedEvents,
  fomcDecision,
  headlineEvents,
  parseFeed,
} from "./feeds";
import { fetchCoverage, fetchIntraday, gdeltUrl, parseTimeline, type Fetcher } from "./gdelt";

// The events overlay's sources, on recorded responses only (./__fixtures__, recorded 2026-10-26):
// the Fed's monetary feed and one FOMC statement, BLS's CPI feed, EIA's Today in Energy, and a
// GDELT timeline. No test makes a network call.

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("the feeds, on recorded responses", () => {
  it("reads the Fed's RSS items with their times and links", () => {
    const items = parseFeed(fixture("fed-monetary.xml"));
    expect(items.length).toBeGreaterThan(10);
    const statement = items.find((i) => i.link?.endsWith("monetary20260916a.htm"));
    expect(statement).toMatchObject({
      title: "Federal Reserve issues FOMC statement",
      published: "2026-09-16T18:00:00.000Z",
    });
    expect(items[0].title).toContain("Board's discount rate meetings");
  });

  it("reads an FOMC statement's decision from its page", () => {
    expect(fomcDecision(fixture("fomc-2026-09-16.html"))).toBe("fed_hike");
    expect(
      fomcDecision("The Committee decided to lower the target range for the federal funds rate"),
    ).toBe("fed_cut");
    expect(fomcDecision("The Committee decided to maintain the target range")).toBeNull();
  });

  it("turns the Fed's feed into rate events, known when the statement came out", async () => {
    const items = parseFeed(fixture("fed-monetary.xml"));
    const page = vi.fn(async (url: string) =>
      url.endsWith("monetary20260916a.htm") ? fixture("fomc-2026-09-16.html") : null,
    );
    const events = await fedEvents(items, page);
    expect(events).toEqual([
      expect.objectContaining({
        key: "fed:fed_hike:2026-09-16",
        type: "fed_hike",
        source: "fed",
        knownAt: "2026-09-16T18:00:00.000Z",
      }),
    ]);
    // 2pm in Washington: in time for that day's close.
    expect(knownBy(events[0], "2026-09-16")).toBe(true);
  });

  it("reads BLS's CPI releases and flags a hot month only", () => {
    const items = parseFeed(fixture("bls-cpi.xml"));
    expect(items[0].title).toBe("CPI for all items increases 0.6% in September; gasoline rises");
    const events = cpiEvents(items);
    // September 0.6%, May 0.5%, April 0.6%, March 0.9% and one in 2025; August's 0.4% and the
    // quieter months are left out.
    expect(events.map((e) => e.date)).toEqual([
      "2026-10-14",
      "2026-06-10",
      "2026-05-12",
      "2026-04-10",
      "2025-12-18",
    ]);
    expect(events.every((e) => e.strength >= 0.5)).toBe(true);
    expect(events[0]).toMatchObject({ type: "inflation_hot", strength: 0.6 });
  });

  it("reads EIA's feed and finds no oil shock in ordinary energy news", () => {
    const items = parseFeed(fixture("eia-today.xml"));
    expect(items.length).toBeGreaterThan(10);
    expect(eiaEvents(items)).toEqual([]);
    expect(
      eiaEvents([
        {
          title: "Pipeline outage halts crude flows to Gulf Coast refineries",
          link: null,
          published: "2026-10-20T14:00:00.000Z",
          summary: "",
        },
      ]),
    ).toHaveLength(1);
  });

  it("gives no events when a feed doesn't answer, and names it", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 503, text: async () => "" }));
    const out = await feedEvents({ fetcher: fetcher as unknown as Fetcher });
    expect(out.events).toEqual([]);
    expect(out.failed.sort()).toEqual(["bls_cpi", "eia", "fed"]);
  });

  it("reads stored headlines, known only once their day has ended", () => {
    const [e] = headlineEvents([
      { date: "2026-10-09", title: "Iran fires missiles at Israel", url: null },
      { date: "2026-10-09", title: "Apple names a new head of services", url: null },
    ]);
    expect(e).toMatchObject({ type: "me_conflict", source: "news" });
    expect(knownBy(e, "2026-10-09")).toBe(false);
    expect(knownBy(e, "2026-10-12")).toBe(true);
  });
});

describe("GDELT, on a recorded response", () => {
  it("builds the request for a type's query and date range", () => {
    const url = gdeltUrl(EVENT_TYPES.me_conflict.gdelt, "2017-01-01", "2017-02-14");
    expect(url).toContain("mode=timelinevolraw");
    expect(url).toContain("startdatetime=20170101000000");
    expect(url).toContain("enddatetime=20170214235959");
    expect(decodeURIComponent(url)).toContain(EVENT_TYPES.me_conflict.gdelt);
  });

  it("parses a day's articles and that day's total", () => {
    const json = JSON.parse(fixture("gdelt-me-conflict-2017.json"));
    // The recorded query is the one in the config.
    expect(json.query_details.title).toBe(EVENT_TYPES.me_conflict.gdelt);
    const rows = parseTimeline(json);
    expect(rows).toHaveLength(45);
    expect(rows[0]).toEqual({ date: "2017-01-01", count: 1106, total: 427906 });
  });

  it("asks one type at a time and keeps going when GDELT turns one away", async () => {
    const recorded = fixture("gdelt-me-conflict-2017.json");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => recorded })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Please limit requests to one every 5 seconds",
      });
    const out = await fetchCoverage(["me_conflict", "war"], "2017-01-01", "2017-02-14", {
      fetcher,
      spacingMs: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(out.coverage.me_conflict).toHaveLength(45);
    expect(out.failed).toEqual(["war"]);
  });

  // Debugger 11-01: the daily events job ran out of Vercel's time (a 504): a GDELT request that
  // never answered held the job, and the ones after it waited their turn.
  it("gives up on a request that doesn't answer, and goes on to the next type", async () => {
    const recorded = fixture("gdelt-me-conflict-2017.json");
    const hangs: Fetcher = (_url, init) =>
      new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new Error("timed out"))),
      );
    const fetcher = vi
      .fn<Fetcher>()
      .mockImplementationOnce(hangs)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => recorded });
    const out = await fetchCoverage(["war", "me_conflict"], "2017-01-01", "2017-02-14", {
      fetcher,
      spacingMs: 0,
      timeoutMs: 20,
    });
    expect(out.failed).toEqual(["war"]);
    expect(out.coverage.me_conflict).toHaveLength(45);
  });

  it("starts no request once the job's deadline has passed, and names those types", async () => {
    const fetcher = vi.fn<Fetcher>();
    const past = Date.now() - 1;
    const daily = await fetchCoverage(["war", "me_conflict"], "2017-01-01", "2017-02-14", {
      fetcher,
      spacingMs: 0,
      deadline: past,
    });
    const hourly = await fetchIntraday(["war"], "2017-01-01T00:00:00Z", "2017-01-02T00:00:00Z", {
      fetcher,
      spacingMs: 0,
      deadline: past,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(daily.failed).toEqual(["war", "me_conflict"]);
    expect(hourly.failed).toEqual(["war"]);
  });
});
