import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectStarted,
  pageOf,
  renderKind,
  renderLine,
  resetRenderTimingForTests,
  roundTripStarted,
  type RenderTiming,
} from "./render-timing";

function fresh(): RenderTiming {
  return {
    startedAt: performance.now(),
    roundTrips: 0,
    sqlCount: 0,
    dbMs: 0,
    inFlight: 0,
    busySince: 0,
    connects: 0,
    connectMs: 0,
  };
}

describe("a render's timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRenderTimingForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("counts round trips and statements, and parallel ones' time once", () => {
    const timing = fresh();
    const first = roundTripStarted(2, timing);
    vi.advanceTimersByTime(30);
    const second = roundTripStarted(1, timing);
    vi.advanceTimersByTime(40);
    first();
    vi.advanceTimersByTime(10);
    second();
    second(); // a second call changes nothing
    vi.advanceTimersByTime(100); // nothing in flight
    const third = roundTripStarted(3, timing);
    vi.advanceTimersByTime(20);
    third();

    expect(timing).toMatchObject({ roundTrips: 3, sqlCount: 6, inFlight: 0 });
    expect(Math.round(timing.dbMs)).toBe(100);
  });

  it("counts new connections and their time", () => {
    const timing = fresh();
    const ended = connectStarted(timing);
    vi.advanceTimersByTime(250);
    ended();
    ended();
    expect(timing.connects).toBe(1);
    expect(Math.round(timing.connectMs)).toBe(250);
  });

  it("is one line with numbers and nothing about the person; only the first render is cold", () => {
    const timing = fresh();
    const ended = roundTripStarted(1, timing);
    vi.advanceTimersByTime(80);
    ended();
    vi.advanceTimersByTime(20);
    const line = renderLine(timing, "/home", "document");
    expect(line).toMatchObject({
      page: "/home",
      kind: "document",
      ms: 100,
      dbMs: 80,
      roundTrips: 1,
      sqlCount: 1,
      connects: 0,
      cold: true,
    });
    expect(Object.keys(line).sort()).toEqual(
      [
        "page",
        "kind",
        "ms",
        "dbMs",
        "roundTrips",
        "sqlCount",
        "connects",
        "connectMs",
        "cold",
        "uptimeS",
        "region",
      ].sort(),
    );
    expect(renderLine(fresh(), "/money", "rsc").cold).toBe(false);
  });

  it("counts a statement still running at the end up to the end", () => {
    const timing = fresh();
    roundTripStarted(1, timing);
    vi.advanceTimersByTime(60);
    expect(renderLine(timing, "/home", "rsc").dbMs).toBe(60);
  });

  it("keeps only the first part of the path, so no token or id reaches the log", () => {
    expect(pageOf("/home")).toBe("/home");
    expect(pageOf("/s/0123456789abcdef")).toBe("/s");
    expect(pageOf("/report/clx9z2k3?x=1")).toBe("/report");
    expect(pageOf("/life-events")).toBe("/life-events");
    expect(pageOf("/")).toBe("/");
    expect(pageOf("/Some Thing")).toBeNull();
    expect(pageOf(null)).toBeNull();
  });

  it("tells a whole page from an app request and an action", () => {
    const headers = (entries: Record<string, string>) => new Headers(entries);
    expect(renderKind(headers({}))).toBe("document");
    expect(renderKind(headers({ rsc: "1" }))).toBe("rsc");
    expect(renderKind(headers({ rsc: "1", "next-action": "abc" }))).toBe("action");
  });
});
