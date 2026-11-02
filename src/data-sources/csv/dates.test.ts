import { describe, expect, it } from "vitest";
import { detectDateOrder, looksLikeDate, parseDate, parseTextDate } from "./dates";

describe("parseDate", () => {
  it("reads numeric dates in the order given, with any separator", () => {
    expect(parseDate("05/09/2026", "mdy")).toBe("2026-05-09");
    expect(parseDate("05/09/2026", "dmy")).toBe("2026-09-05");
    expect(parseDate("5-9-26", "dmy")).toBe("2026-09-05");
    expect(parseDate("05.09.2026", "dmy")).toBe("2026-09-05");
    expect(parseDate("13/09/2026", "mdy")).toBeNull();
  });

  it("never reads an ambiguous numeric date without an order", () => {
    expect(parseDate("05/09/2026", null)).toBeNull();
    // The same either way.
    expect(parseDate("03/03/2026", null)).toBe("2026-03-03");
  });

  it("reads ISO and written-out dates without an order", () => {
    expect(parseDate("2026-09-05", null)).toBe("2026-09-05");
    expect(parseDate("2026/09/05", null)).toBe("2026-09-05");
    expect(parseDate("2026-09-05T00:00:00Z", null)).toBe("2026-09-05");
    expect(parseDate("Sep 5, 2026", null)).toBe("2026-09-05");
  });
});

describe("parseTextDate", () => {
  it.each([
    ["Sep 5, 2026", "2026-09-05"],
    ["September 5 2026", "2026-09-05"],
    ["Sept. 5, 2026", "2026-09-05"],
    ["5 Sep 2026", "2026-09-05"],
    ["05-Sep-2026", "2026-09-05"],
    ["5-Sep-26", "2026-09-05"],
    ["Sep 31, 2026", null],
    ["Sepi 5, 2026", null],
  ])("reads %j as %j", (value, iso) => {
    expect(parseTextDate(value)).toBe(iso);
  });
});

describe("detectDateOrder", () => {
  it("is settled by a day over 12 on either side", () => {
    expect(detectDateOrder(["05/09/2026", "13/09/2026"])).toBe("dmy");
    expect(detectDateOrder(["05/09/2026", "09/13/2026"])).toBe("mdy");
  });

  it("is settled by the rows staying in date order one way only", () => {
    // As month first: May 9, Jun 8, Jul 7 (in order). As day first: 5 Sep, 6 Aug, 7 Jul (in
    // order too, newest first), so this alone can't tell.
    expect(detectDateOrder(["05/09/2026", "06/08/2026", "07/07/2026"])).toBe("unknown");
    // Month first: Jan 2, Feb 1, Jan 3 (out of order). Day first: 1 Feb, 2 Jan... 3 Jan.
    expect(detectDateOrder(["01/02/2026", "02/01/2026", "01/03/2026"])).toBe("unknown");
    // Month first: Oct 1, Oct 2, Nov 1 (in order). Day first: 10 Jan, 10 Feb, 11 Jan (not).
    expect(detectDateOrder(["10/01/2026", "10/02/2026", "11/01/2026"])).toBe("mdy");
  });

  it("asks when it can't tell, and has nothing to ask without numeric dates", () => {
    expect(detectDateOrder(["05/09/2026"])).toBe("unknown");
    expect(detectDateOrder(["03/03/2026", "04/04/2026"])).toBe("mdy");
    expect(detectDateOrder(["2026-09-05", "Sep 5, 2026"])).toBeNull();
    expect(detectDateOrder(["COFFEE"])).toBeNull();
  });
});

describe("looksLikeDate", () => {
  it("tells dates from column names", () => {
    expect(looksLikeDate("13/09/2026")).toBe(true);
    expect(looksLikeDate("Sep 5, 2026")).toBe(true);
    expect(looksLikeDate("Date")).toBe(false);
  });
});

// Debugger 11-02: Cash App writes "2026-10-20 13:22:10 EDT", and no row could be read.
describe("a date with a time after it", () => {
  it.each([
    ["2026-10-20 13:22:10 EDT", "2026-10-20"],
    ["2026-10-20 13:22:10", "2026-10-20"],
    ["2026-10-20 13:22", "2026-10-20"],
    ["2026-10-20T13:22:10Z", "2026-10-20"],
    ["2026-10-20T13:22:10.123Z", "2026-10-20"],
    ["2026-10-20T13:22:10-04:00", "2026-10-20"],
    ["2026-10-20 13:22:10 +0000", "2026-10-20"],
    ["2026-10-20 1:22 PM", "2026-10-20"],
    ["10/20/2026 13:22:10", "2026-10-20"],
    ["10/20/2026 1:22 PM", "2026-10-20"],
    ["10/20/2026 1:22:10 pm PST", "2026-10-20"],
  ])("reads %s as the day written", (value, day) => {
    expect(parseDate(value, "mdy")).toBe(day);
  });

  it("keeps the order the column needs, and settles it with the time there", () => {
    expect(parseDate("20/10/2026 13:22", "dmy")).toBe("2026-10-20");
    expect(detectDateOrder(["20/10/2026 13:22", "21/10/2026 08:00"])).toBe("dmy");
  });

  it.each([
    "2026-10-20 hello",
    "2026-10-20 13",
    "10/20/2026 paid",
    "13:22:10 EDT",
    "tx 2026-10-20",
  ])("still isn't a date: %s", (value) => {
    expect(looksLikeDate(value)).toBe(false);
  });
});
