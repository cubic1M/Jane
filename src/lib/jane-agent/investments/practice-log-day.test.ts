import { describe, expect, it } from "vitest";
import { practiceLogReply } from "./practice-copy";

// Debugger 11-13 (from the simplify pass): the practice log labelled each trade's day in UTC
// through a local helper the moment-labels guard can't see. A trade placed at 6:30pm in Los
// Angeles read as the next day. Same trade, 3pm and 7pm Pacific: each is the day it was placed.

const trade = (placedAt: string) => ({
  placedAt: new Date(placedAt),
  side: "buy",
  ticker: "VTI",
  amountCents: 10_000,
  rule: "rebalance",
  reason: "Back to the mix.",
});
const line = (placedAt: string, timezone: string) =>
  practiceLogReply({ level: 3, paused: false }, [trade(placedAt)], true, false, timezone).body;

describe("the practice log's days", () => {
  it("are the person's own day either side of midnight UTC", () => {
    // 3pm and 7pm Pacific on Nov 12 (23:00Z on the 12th, 03:00Z on the 13th).
    expect(line("2026-11-12T23:00:00Z", "America/Los_Angeles")).toContain("- Nov 12:");
    expect(line("2026-11-13T03:00:00Z", "America/Los_Angeles")).toContain("- Nov 12:");
    // The same moment for someone in London is already the 13th.
    expect(line("2026-11-13T03:00:00Z", "Europe/London")).toContain("- Nov 13:");
  });

  it("uses US Pacific when the zone isn't known, as timezoneOf does", () => {
    expect(
      practiceLogReply({ level: 3, paused: false }, [trade("2026-11-13T03:00:00Z")], true).body,
    ).toContain("- Nov 12:");
  });
});
