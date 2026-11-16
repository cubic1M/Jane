import { describe, expect, it } from "vitest";
import { holdingsReply } from "./replies";
import type { Investments } from "@/lib/investments/holdings";

// Debug 2 re-walk (11-16, Plaid sandbox checking sending $500 a month to Fidelity, 1280 light):
// "how much have I invested?" → "I don't see any investment or retirement accounts yet", while
// the Investments page said "You put $1,500.00 into investing in the last 3 months". The chat says
// what went in, as the page does.

const none = { accounts: [] } as unknown as Investments;
const sent = {
  asks: [{ app: "Fidelity", inCents: 150_000, count: 3, lastDate: "2026-11-06" }],
  inLast3MonthsCents: 150_000,
};

describe("investments, with money sent to a brokerage and no account on file", () => {
  it("says what went in, and where to say what's there now", () => {
    const reply = holdingsReply(none, null, sent);
    expect(reply.body).toMatch(
      /^You sent \$1,500\.00 to Fidelity in the last 3 months\. Your bank shows money going in, not what it's worth now/,
    );
    expect(reply.actions.map((a) => a.label)).toEqual([
      "Say what's in it",
      "Upload your investments",
    ]);
  });

  it("is as before with nothing sent", () => {
    expect(holdingsReply(none, null, { asks: [], inLast3MonthsCents: 0 }).body).toMatch(
      /^I don't see any investment or retirement accounts yet\./,
    );
  });
});
