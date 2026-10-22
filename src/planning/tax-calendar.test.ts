import { describe, expect, it } from "vitest";
import {
  CALENDAR_ITEMS,
  ESTIMATE_PAY_GRACE_DAYS,
  ESTIMATE_PAY_LEAD_DAYS,
  TAX_CALENDAR,
} from "@/config/tax-calendar";
import { inPayWindow, nextAhead, planFor } from "./tax-calendar";

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
