import { describe, expect, it } from "vitest";
import { CHECKING, input, tx } from "@/detection/__fixtures__/build";
import { bankingDayOnOrBefore } from "@/detection/business-days";
import { expectedPaydays, nextPayday } from "@/detection/paydays";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import { safeToSpend } from "./safe-to-spend";

// Pay paid early for a weekend or a bank holiday is pay that came in (manager, 11-20): a false "Not
// counted: … pay due Nov 15, which hasn't come in" would alarm someone whose pay is in checking.
// Each read is after the early deposit, through the days it would otherwise be due, late or missed.

const PAY = 210_000;
const BALANCE = 400_000;
const RENT = 150_000;
const paycheck = (date: string) =>
  tx({
    date,
    amountCents: -PAY,
    description: "NORTHWIND LABS PAYROLL",
    merchantName: "Northwind Labs",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_SALARY",
  });
const rent = ["2026-09-03", "2026-10-03", "2026-11-03"].map((date) =>
  tx({ date, amountCents: RENT, description: "AVALON RENT", merchantName: "Avalon" }),
);

const linked = (asOf: string, paid: string[]): DetectionInput =>
  input({
    asOf,
    accounts: [{ ...CHECKING, currentBalanceCents: BALANCE }],
    transactions: [...paid.map(paycheck), ...rent],
  });
const safe = (data: DetectionInput) => safeToSpend(data, { budgetsLeftCents: 0, goalsCents: 0 });

// Every read: nothing due, nothing missed, the pay once (in the balance, none on top), and the
// next two paydays where they should be (the schedule's days, not one a day off them).
function paidOnce(data: DetectionInput, next: [string, string]) {
  const result = safe(data);
  expect(result.payDue).toEqual([]);
  expect(result.payMissed).toEqual([]);
  expect(result.safeCents).toBe(BALANCE - result.billsCents);
  expect(nextPayday(data, 45)?.date).toBe(next[0]);
  expect(
    expectedPaydays(data, addDays(data.asOf, 45))
      .map((p) => p.dueOn)
      .slice(0, 2),
  ).toEqual(next);
}

// The 15th and the month's last day, paid the banking day before a weekend or holiday.
const semiMonthly = (months: string[]) =>
  months.flatMap((month) => {
    const last = addDays(`${month}-01`, 40).slice(0, 8) + "01";
    return [`${month}-15`, addDays(last, -1)].map(bankingDayOnOrBefore);
  });

describe("twice a month, on a Sunday the 15th paid Friday the 13th", () => {
  // Mar 15, May 31, Aug 15 and Oct 31 were weekends too, each paid the Friday before.
  const history = semiMonthly([
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
  ]);

  it("the history shows early Fridays", () => {
    expect(history).toContain("2026-03-13");
    expect(history).toContain("2026-05-29");
    expect(history).toContain("2026-08-14");
    expect(history).toContain("2026-10-30");
  });

  for (const asOf of ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]) {
    it(`read on ${asOf}: paid once, next paydays Nov 30 and Dec 15`, () => {
      paidOnce(linked(asOf, [...history, "2026-11-13"]), ["2026-11-30", "2026-12-15"]);
    });
  }
});

describe("twice a month with too little history to show the shift", () => {
  // Oct 15 and Oct 30, both weekdays, then Friday Nov 13: the three paychecks a schedule needs.
  for (const asOf of ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]) {
    it(`read on ${asOf}: paid once, next paydays Nov 30 and Dec 15`, () => {
      paidOnce(linked(asOf, ["2026-10-15", "2026-10-30", "2026-11-13"]), [
        "2026-11-30",
        "2026-12-15",
      ]);
    });
  }
});

describe("a bank that posts on weekends, paid the Friday before this once", () => {
  // The 1st and the 15th on the day, Saturdays and Sundays too (as the demo bank posts), so the
  // schedule doesn't move a weekend payday; then Sunday Nov 15's pay on Friday Nov 13.
  const onTheDay = Array.from({ length: 8 }, (_, i) => `2026-${String(i + 3).padStart(2, "0")}`)
    .flatMap((month) => [`${month}-01`, `${month}-15`])
    .concat("2026-11-01");

  it("the history has weekend paydays on the day", () => {
    expect(onTheDay).toContain("2026-03-01");
    expect(onTheDay).toContain("2026-11-01");
    expect(onTheDay).not.toContain("2026-11-15");
  });

  for (const asOf of ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]) {
    it(`read on ${asOf}: paid once, next paydays Dec 1 and Dec 15`, () => {
      paidOnce(linked(asOf, [...onTheDay, "2026-11-13"]), ["2026-12-01", "2026-12-15"]);
    });
  }
});

describe("every two weeks on Fridays, Thanksgiving week's paid Wednesday", () => {
  // Fridays through Nov 13, then Nov 27's pay on Wednesday Nov 25: Thursday the 26th is a bank
  // holiday, and Friday the 27th isn't, so the schedule doesn't move it.
  const fridays = Array.from({ length: 12 }, (_, i) => addDays("2026-11-13", -14 * i));

  for (const asOf of [
    "2026-11-25",
    "2026-11-26",
    "2026-11-27",
    "2026-11-28",
    "2026-11-29",
    "2026-11-30",
  ]) {
    it(`read on ${asOf}: paid once, next paydays Dec 11 and Christmas Eve`, () => {
      paidOnce(linked(asOf, [...fridays, "2026-11-25"]), ["2026-12-11", "2026-12-24"]);
    });
  }
});
