import { describe, expect, it } from "vitest";
import {
  daysRequestedFor,
  historyLine,
  holdsAllAsked,
  offerFullHistory,
  rescanDue,
} from "./history";

const NOW = new Date("2026-11-27T12:00:00Z");
const held = (earliest: string | null) => ({ earliest, latest: earliest, count: earliest ? 5 : 0 });
const judged = (over: Partial<Parameters<typeof rescanDue>[0]> = {}) => ({
  held: held("2026-10-19"),
  status: null as string | null,
  linkedAt: new Date("2026-11-18T12:00:00Z"),
  rescannedAt: null as string | null,
  now: NOW,
  ...over,
});

describe("how far back a bank's history goes", () => {
  it("knows how many days a link asked for from the day it was made", () => {
    expect(daysRequestedFor(new Date("2026-11-18T12:00:00Z"))).toBe(365);
    expect(daysRequestedFor(new Date("2026-11-29T12:00:00Z"))).toBe(730);
  });

  it("holds all that was asked within the slack, and not a month short", () => {
    const linked = new Date("2026-11-18T12:00:00Z");
    expect(holdsAllAsked(held("2025-11-20"), linked)).toBe(true);
    expect(holdsAllAsked(held("2025-12-20"), linked)).toBe(false);
    expect(holdsAllAsked(held(null), linked)).toBe(false);
  });

  it("reads again from the start once: after a day when Plaid says complete, after three days otherwise", () => {
    expect(rescanDue(judged({ status: "HISTORICAL_UPDATE_COMPLETE" }))).toBe(true);
    expect(rescanDue(judged())).toBe(true);
    // Not a link under a day old, and not one that already holds all it asked for.
    expect(
      rescanDue(
        judged({
          linkedAt: new Date("2026-11-27T01:00:00Z"),
          status: "HISTORICAL_UPDATE_COMPLETE",
        }),
      ),
    ).toBe(false);
    expect(
      rescanDue(
        judged({ linkedAt: new Date("2026-11-25T12:00:00Z"), status: "INITIAL_UPDATE_COMPLETE" }),
      ),
    ).toBe(false);
    expect(rescanDue(judged({ held: held("2025-11-20") }))).toBe(false);
    // Never twice.
    expect(rescanDue(judged({ rescannedAt: NOW.toISOString() }))).toBe(false);
  });

  it("offers the one tap only after Plaid says complete and the read-again still left it short", () => {
    const done = judged({ status: "HISTORICAL_UPDATE_COMPLETE", rescannedAt: "x" });
    expect(offerFullHistory(done)).toBe(true);
    expect(offerFullHistory({ ...done, rescannedAt: null })).toBe(false);
    expect(offerFullHistory({ ...done, status: "INITIAL_UPDATE_COMPLETE" })).toBe(false);
    expect(offerFullHistory({ ...done, held: held("2025-11-20") })).toBe(false);
    // A link that already asked for the most can't be made longer by a new one.
    expect(offerFullHistory({ ...done, linkedAt: new Date("2026-11-29T12:00:00Z") })).toBe(false);
  });

  it("says it in plain facts", () => {
    expect(historyLine("Chase", held("2026-10-19"), "HISTORICAL_UPDATE_COMPLETE").text).toBe(
      "History from Chase: Oct 19, 2026 to today (this is everything Chase gave).",
    );
    expect(historyLine("Chase", held("2026-10-19"), "INITIAL_UPDATE_COMPLETE").text).toBe(
      "History from Chase: Oct 19, 2026 to today (Plaid is still sending older history).",
    );
    expect(historyLine("Chase", held("2026-10-19"), null).state).toBe("unknown");
    expect(historyLine("Chase", held(null), null).state).toBe("empty");
  });
});
