import { describe, expect, it } from "vitest";
import { seenConfidence } from "./sure";

const input = (historyFrom: string) => ({ asOf: "2026-10-15", historyFrom, transactions: [] });

describe("seenConfidence", () => {
  it("grows with the months of statements and the charges that show it", () => {
    const short = seenConfidence(input("2026-07-15"), 2, "earlier charges");
    const long = seenConfidence(input("2025-10-15"), 3, "earlier charges");
    expect(short.percent).toBeLessThan(long.percent);
    expect(long).toEqual({ percent: 87, reason: "3 earlier charges in 12 months of data" });
  });

  it("never goes past its cap", () => {
    expect(seenConfidence(input("2025-10-15"), 1, "first charge", 60).percent).toBe(60);
  });

  it("reads the history from the transactions when it isn't given", () => {
    const sure = seenConfidence(
      {
        asOf: "2026-10-15",
        transactions: [{ date: "2026-04-15" }, { date: "2026-09-01" }] as never,
      },
      1,
      "fee",
    );
    expect(sure.reason).toBe("1 fee in 6 months of data");
  });
});
