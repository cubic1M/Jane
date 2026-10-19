import { describe, expect, it } from "vitest";
import {
  bankHolidays,
  bankingDayOnOrAfter,
  bankingDayOnOrBefore,
  isBankingDay,
} from "./business-days";

describe("banking days", () => {
  it("knows the Federal Reserve's holidays, with Sunday holidays on the Monday", () => {
    expect([...bankHolidays(2026)].sort()).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-06-19",
      "2026-07-04",
      "2026-09-07",
      "2026-10-12",
      "2026-11-11",
      "2026-11-26",
      "2026-12-25",
    ]);
    // New Year's Day 2023 was a Sunday: observed Monday the 2nd.
    expect(bankHolidays(2023).has("2023-01-02")).toBe(true);
  });

  it("skips weekends and holidays", () => {
    expect(isBankingDay("2026-10-16")).toBe(true); // a Friday
    expect(isBankingDay("2026-10-17")).toBe(false); // Saturday
    expect(isBankingDay("2026-10-12")).toBe(false); // Columbus Day
    // July 4th 2026 is a Saturday: the Fed stays open on Friday the 3rd.
    expect(isBankingDay("2026-07-03")).toBe(true);
  });

  it("finds the banking day before and after", () => {
    expect(bankingDayOnOrBefore("2026-11-01")).toBe("2026-10-30");
    expect(bankingDayOnOrBefore("2026-12-25")).toBe("2026-12-24");
    expect(bankingDayOnOrAfter("2026-09-07")).toBe("2026-09-08");
    expect(bankingDayOnOrAfter("2026-10-16")).toBe("2026-10-16");
  });
});
