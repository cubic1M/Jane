import { describe, expect, it } from "vitest";
import { cashCushionOf, type IdleTx } from "./idle-cash";

// Gate C's calendar sweep (src/sweep/), 11-16: a statement through Oct 22, uploaded Oct 25. Its
// spending was averaged to today until the account had been quiet for two weeks, so "spend about
// $2,075 a month" became $2,061 the next day and $2,047 the day after, with nothing new: the
// cushion shrank and the idle cash grew by itself. An upload's statement ends where it closes (a
// week past its last line, never past the day it was uploaded), however recent; a linked account's
// quiet days are real and still count.

const lines = (uploadedOn?: string): IdleTx[] =>
  ["08", "09", "10"].flatMap((m) =>
    [
      [`2026-${m}-02`, 165_000, "RENT_AND_UTILITIES_RENT", "OAK STREET APARTMENTS RENT"],
      [`2026-${m}-11`, 8_450, "FOOD_AND_DRINK_GROCERIES", "SAFEWAY #1234 OAKLAND CA"],
      [`2026-${m}-22`, 6_120, "FOOD_AND_DRINK_GROCERIES", "TRADER JOES #123 OAKLAND CA"],
    ].map(([date, cents, pfc, description]) => ({
      date: date as string,
      amountCents: cents as number,
      accountId: "chk",
      pfc: pfc as string,
      description: description as string,
      ...(uploadedOn ? { uploadedOn } : {}),
    })),
  );
const input = (asOf: string, uploadedOn?: string) => ({
  asOf,
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 845_000 }],
  transactions: lines(uploadedOn),
});
// 4, 5 and 12 days after the statement's last line.
const DAYS = ["2026-10-26", "2026-10-27", "2026-11-03"];

describe("an uploaded statement's months of spending", () => {
  it("are the same every day after its last line", () => {
    const monthly = DAYS.map((day) => cashCushionOf(input(day, "2026-10-25"))?.monthlyCents);
    expect(monthly[0]).toBeGreaterThan(0);
    expect(monthly).toEqual([monthly[0], monthly[0], monthly[0]]);
  });

  it("still run to today for a linked account's quiet days", () => {
    const monthly = DAYS.map((day) => cashCushionOf(input(day))?.monthlyCents ?? 0);
    expect(monthly[2]).toBeLessThan(monthly[0]);
  });
});
