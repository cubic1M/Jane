import { describe, expect, it } from "vitest";
import type { AccountForecast } from "@/detection/forecast";
import { forecastReply } from "./replies-forecast";

// Debugger 11-20 (upload S3): the chat's balance forecast said "It starts at $2,310.55 today", the
// Nov 12 statement's closing balance, while Home, the bills page and the forecast's own low point
// walk it forward to about $3,878.56 today.
const forecast = (over: Partial<AccountForecast>): AccountForecast => ({
  accountId: "acct_1",
  accountName: "Chase checking",
  startCents: 231055,
  startOn: "2026-11-12",
  staleFrom: null,
  todayCents: 387856,
  lowest: { date: "2026-12-12", balanceCents: 348137 },
  bills: [
    {
      merchant: "Avalon Austin Rent",
      date: "2026-12-01",
      amountCents: 115000,
      accountId: "acct_1",
    },
  ],
  income: [
    { merchant: "Brightwave Media", date: "2026-11-30", amountCents: 158000, accountId: "acct_1" },
  ],
  transfersIn: [],
  days: [{ date: "2026-11-20", balanceCents: 387856 }],
  ...over,
});

describe("the chat's balance forecast starts from today's balance", () => {
  it("says a statement's balance walked to today, and where it came from", () => {
    const { body } = forecastReply([forecast({})]);
    expect(body).toContain("It's about $3,878.56 today, estimated from $2,310.55 on Nov 12.");
    expect(body).not.toContain("It starts at $2,310.55 today");
  });

  it("says a balance from today as it is", () => {
    const { body } = forecastReply([
      forecast({ startOn: "2026-11-20", startCents: 387856, todayCents: 387856 }),
    ]);
    expect(body).toContain("It starts at $3,878.56 today.");
    expect(body).not.toContain("estimated");
  });
});
