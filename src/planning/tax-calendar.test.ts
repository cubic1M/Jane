import { describe, expect, it } from "vitest";
import {
  CALENDAR_ITEMS,
  ESTIMATE_PAY_GRACE_DAYS,
  ESTIMATE_PAY_LEAD_DAYS,
  TAX_CALENDAR,
} from "@/config/tax-calendar";
import { calendarWords, inPayWindow, nextAhead, planFor } from "./tax-calendar";

// Spec step 223: the calendar has something for every month, and an estimated payment is in
// its pay window from a few days before it is due until the grace days after.

describe("the calendar", () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))(
    "month %i has its items, each with a title and both levels' words",
    (m) => {
      const plan = planFor(m);
      expect(plan.items.length).toBeGreaterThan(0);
      expect(plan.items.map((i) => i.key)).toEqual(TAX_CALENDAR[m]);
      for (const i of plan.items) {
        expect(i.title).toBe(CALENDAR_ITEMS[i.key].title);
        expect(i.ask.length, `${m} ${i.key} ask`).toBeGreaterThan(10);
        expect(i.auto.length, `${m} ${i.key} auto`).toBeGreaterThan(10);
      }
    },
  );

  it("puts each part of the tax year in the month it belongs to", () => {
    expect(TAX_CALENDAR[1]).toEqual(expect.arrayContaining(["ip_pin", "documents", "estimate"]));
    expect(TAX_CALENDAR[4]).toEqual(expect.arrayContaining(["filing_day", "estimate", "refund"]));
    expect(TAX_CALENDAR[6]).toEqual(expect.arrayContaining(["withholding", "estimate"]));
    expect(TAX_CALENDAR[9]).toEqual(["estimate"]);
    expect(TAX_CALENDAR[12]).toEqual(["year_end"]);
    expect(planFor(1).label).toBe("January");
    expect(planFor(12).label).toBe("December");
  });
});

describe("the pay window", () => {
  const due = [{ date: "2026-09-15" }, { date: "2027-01-15" }];

  it("opens ESTIMATE_PAY_LEAD_DAYS before the due date and closes after the grace days", () => {
    expect(ESTIMATE_PAY_LEAD_DAYS).toBe(5);
    expect(inPayWindow(due, "2026-09-09")).toEqual([]);
    expect(inPayWindow(due, "2026-09-10")).toEqual([{ date: "2026-09-15" }]);
    expect(inPayWindow(due, "2026-09-15")).toEqual([{ date: "2026-09-15" }]);
    expect(ESTIMATE_PAY_GRACE_DAYS).toBe(30);
    expect(inPayWindow(due, "2026-10-15")).toEqual([{ date: "2026-09-15" }]);
    expect(inPayWindow(due, "2026-10-16")).toEqual([]);
  });

  it("names the next payment still ahead of its window", () => {
    expect(nextAhead(due, "2026-06-20")).toEqual({ date: "2026-09-15" });
    expect(nextAhead(due, "2026-09-10")).toEqual({ date: "2027-01-15" });
    expect(nextAhead(due, "2027-01-11")).toBeNull();
  });
});

// Debugger 11-02: a real account in the read-only beta read "When every form is in, I get your
// return ready for you to review and sign" and "I ask you to pay it, with a button": Jane drafts
// returns for sample data only and moves no money for a real account. Real accounts get their
// own words where the others would promise what Jane doesn't do for them.
describe("the words for a real account", () => {
  const real = { acts: false, advice: false };
  it("promise no return Jane gets ready and no button that pays", () => {
    for (let m = 1; m <= 12; m++) {
      for (const item of planFor(m).items) {
        const words = calendarWords(item, real);
        expect(words, `${m} ${item.key}`).not.toMatch(
          /get your return ready|pay it, with a button|I pay/i,
        );
      }
    }
    expect(calendarWords(planFor(4).items[0], real)).toMatch(/tax-time pack/);
  });

  it("are the same as before for sample data and for Jane acting", () => {
    const filing = planFor(4).items[0];
    expect(calendarWords(filing, { acts: false, advice: true })).toBe(filing.ask);
    expect(calendarWords(filing, { acts: true, advice: true })).toBe(filing.auto);
  });
});
