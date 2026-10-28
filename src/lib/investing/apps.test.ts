import { describe, expect, it } from "vitest";
import { appOf, askQuestion, summarize } from "./apps";

describe("investing apps in a person's transfers", () => {
  it("names the app a statement line is for", () => {
    expect(appOf("ROBINHOOD DEBITS XXXXX1234")).toBe("Robinhood");
    expect(appOf("Fidelity Investments TRANSFER")).toBe("Fidelity");
    expect(appOf("ACORNS INVEST 8123")).toBe("Acorns");
    expect(appOf("E*TRADE SECURITIES ACH")).toBe("E*Trade");
    expect(appOf("COINBASE.COM")).toBe("Coinbase");
    expect(appOf("TRADER JOES")).toBeNull();
  });

  it("adds up what went in over the window, biggest first, ignoring money coming back", () => {
    const rows = [
      { date: "2026-10-01", amountCents: 50_000, description: "ROBINHOOD DEBITS" },
      { date: "2026-09-01", amountCents: 50_000, description: "ROBINHOOD DEBITS" },
      { date: "2026-09-15", amountCents: 20_000, description: "VANGUARD BUY INVESTMENT" },
      { date: "2026-09-20", amountCents: -5_000, description: "ROBINHOOD CREDIT" },
      { date: "2026-05-01", amountCents: 99_900, description: "SCHWAB" },
      { date: "2026-10-02", amountCents: 1_200, description: "GROCERY" },
    ];
    const s = summarize(rows, "2026-07-20", "2026-10-20");
    expect(s).toEqual([
      { app: "Robinhood", inCents: 100_000, count: 2, lastDate: "2026-10-01" },
      { app: "Vanguard", inCents: 20_000, count: 1, lastDate: "2026-09-15" },
    ]);
  });

  it("asks in the person's words", () => {
    expect(askQuestion("Robinhood")).toBe("What's in your Robinhood account today?");
  });
});
