import { describe, expect, it } from "vitest";
import { demoTransactions } from "@/data-sources/demo/demo-bank";
import { CHECKING, SAVINGS, tx } from "./__fixtures__/build";
import { bankingDayOnOrAfter, bankingDayOnOrBefore } from "./business-days";
import { expectedIncome } from "./forecast";
import { isPaycheck, nextPayday, paySchedules } from "./paydays";
import type { DetectionInput, DetectionTransaction } from "./types";
import { addDays } from "./units";

const PAYROLL = {
  description: "ACME CORP PAYROLL",
  pfcPrimary: "INCOME",
  pfcDetailed: "INCOME_SALARY",
  amountCents: -245_000,
};

const paid = (dates: string[], overrides: Partial<DetectionTransaction> = {}) =>
  dates.map((date) => tx({ ...PAYROLL, ...overrides, date }));

const input = (asOf: string, transactions: DetectionTransaction[]): DetectionInput => ({
  asOf,
  accounts: [CHECKING, SAVINGS],
  transactions,
  recurringStreams: [],
});

// Every date of a schedule from `from` through `until`, stepping `step` days.
const every = (from: string, until: string, step: number) => {
  const out: string[] = [];
  for (let d = from; d <= until; d = addDays(d, step)) out.push(d);
  return out;
};

// The given days of each month from `from` through `until` (31: the last day).
const monthDays = (from: string, until: string, days: number[]) => {
  const out: string[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) {
    const last = addDays(d, 1).slice(8) === "01";
    if (days.includes(Number(d.slice(8))) || (days.includes(31) && last)) out.push(d);
  }
  return out;
};

describe("isPaycheck", () => {
  it("takes payroll by category or by name", () => {
    expect(isPaycheck(tx(PAYROLL))).toBe(true);
    expect(
      isPaycheck(
        tx({
          description: "GUSTO DIR DEP 102226",
          pfcDetailed: "TRANSFER_IN_DEPOSIT",
          amountCents: -180_000,
        }),
      ),
    ).toBe(true);
  });

  it("never takes interest, a refund, a transfer or a small deposit", () => {
    expect(
      isPaycheck(
        tx({
          description: "INTEREST PAYMENT",
          pfcDetailed: "INCOME_INTEREST_EARNED",
          amountCents: -102,
        }),
      ),
    ).toBe(false);
    expect(
      isPaycheck(
        tx({
          description: "INTEREST PAYROLL",
          pfcDetailed: "INCOME_INTEREST_EARNED",
          amountCents: -50_000,
        }),
      ),
    ).toBe(false);
    expect(
      isPaycheck(
        tx({
          description: "AMAZON REFUND",
          pfcDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
          amountCents: -40_000,
        }),
      ),
    ).toBe(false);
    expect(
      isPaycheck(
        tx({
          description: "SALARY SAVINGS TRANSFER",
          pfcDetailed: "TRANSFER_IN_SAVINGS",
          amountCents: -200_000,
        }),
      ),
    ).toBe(false);
    expect(isPaycheck(tx({ ...PAYROLL, amountCents: -5_000 }))).toBe(false);
  });
});

describe("pay schedules", () => {
  it("twice a month on the 1st and 15th, paid the Friday before a weekend", () => {
    const dates = monthDays("2026-01-01", "2026-10-19", [1, 15]).map(bankingDayOnOrBefore);
    // Hand-checked shifts: Sunday Feb 1 -> Friday Jan 30, Saturday Aug 15 -> Friday Aug 14.
    expect(dates).toContain("2026-01-30");
    expect(dates).toContain("2026-08-14");
    const data = input("2026-10-19", paid(dates));
    const [schedule] = paySchedules(data);
    expect(schedule).toMatchObject({
      frequency: "SEMI_MONTHLY",
      days: [1, 15],
      shift: "before",
      employer: expect.stringMatching(/acme/i),
      amountCents: 245_000,
      active: true,
    });
    // Sunday November 1st is paid on Friday October 30th.
    expect(nextPayday(data, 31)?.date).toBe("2026-10-30");
  });

  it("twice a month on the 15th and the last day", () => {
    const dates = monthDays("2026-03-01", "2026-10-16", [15, 31]).map(bankingDayOnOrBefore);
    const data = input("2026-10-19", paid(dates));
    expect(paySchedules(data)[0]).toMatchObject({ frequency: "SEMI_MONTHLY", days: [15, 31] });
    // Saturday October 31st is paid on Friday the 30th.
    expect(nextPayday(data, 31)?.date).toBe("2026-10-30");
  });

  it("every two weeks on Fridays, a holiday paid the day before", () => {
    // Juneteenth (Friday June 19th, 2026) was paid on Thursday the 18th.
    const dates = every("2026-05-08", "2026-10-16", 14).map(bankingDayOnOrBefore);
    expect(dates).toContain("2026-06-18");
    const data = input("2026-10-19", paid(dates));
    expect(paySchedules(data)[0]).toMatchObject({ frequency: "BIWEEKLY", shift: "before" });
    // The last was Friday October 9th.
    expect(nextPayday(data, 31)?.date).toBe("2026-10-23");
  });

  it("every two weeks, and Christmas on a Friday comes on Christmas Eve", () => {
    const dates = every("2026-07-24", "2026-12-11", 14);
    const data = input("2026-12-20", paid(dates));
    expect(paySchedules(data)[0].frequency).toBe("BIWEEKLY");
    expect(nextPayday(data, 31)?.date).toBe("2026-12-24");
  });

  it("weekly on Mondays, a holiday paid the day after", () => {
    // Labor Day (September 7th) was paid on Tuesday the 8th.
    const dates = every("2026-07-06", "2026-10-05", 7).map(bankingDayOnOrAfter);
    expect(dates).toContain("2026-09-08");
    const data = input("2026-10-07", paid(dates, { amountCents: -90_000 }));
    expect(paySchedules(data)[0]).toMatchObject({ frequency: "WEEKLY", shift: "after" });
    // Columbus Day, Monday October 12th: Tuesday the 13th.
    expect(nextPayday(data, 31)?.date).toBe("2026-10-13");
  });

  it("monthly on the 25th, paid the banking day before", () => {
    const dates = monthDays("2026-01-01", "2026-09-30", [25]).map(bankingDayOnOrBefore);
    const data = input("2026-10-19", paid(dates, { amountCents: -480_000 }));
    expect(paySchedules(data)[0]).toMatchObject({ frequency: "MONTHLY", days: [25] });
    // Sunday October 25th: Friday the 23rd.
    expect(nextPayday(data, 31)?.date).toBe("2026-10-23");
  });

  it("counts a paycheck that posts a day late, and a pay split between accounts once", () => {
    const dates = monthDays("2026-04-01", "2026-10-16", [1, 15]).map(bankingDayOnOrBefore);
    const late = dates.map((d, i) => (i === 3 ? addDays(d, 1) : d));
    const split = paid(["2026-10-15"], { accountId: SAVINGS.id, amountCents: -50_000 });
    const data = input("2026-10-19", [...paid(late), ...split]);
    const [schedule] = paySchedules(data);
    expect(schedule).toMatchObject({ frequency: "SEMI_MONTHLY", days: [1, 15] });
    expect(schedule.amountCents).toBe(295_000);
  });

  it("finds no payday in irregular deposits, or in pay that stopped", () => {
    const gig = paid(["2026-07-02", "2026-07-21", "2026-08-03", "2026-09-17", "2026-10-09"], {
      description: "UPWORK PAYROLL",
    });
    expect(nextPayday(input("2026-10-19", gig), 31)).toBeNull();
    const stopped = paid(every("2026-02-06", "2026-06-26", 14));
    expect(paySchedules(input("2026-10-19", stopped))[0].active).toBe(false);
    expect(nextPayday(input("2026-10-19", stopped), 31)).toBeNull();
  });

  it("never makes interest a payday", () => {
    const interest = monthDays("2026-01-01", "2026-10-19", [28]).map((date) =>
      tx({
        accountId: SAVINGS.id,
        date,
        description: "INTEREST PAYMENT",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_INTEREST_EARNED",
        amountCents: -102,
      }),
    );
    expect(nextPayday(input("2026-10-19", interest), 31)).toBeNull();
  });
});

// The demo bank's Plaid-shaped transactions as the rules see them.
function demoInput(asOf: string): DetectionInput {
  const rows = demoTransactions({ seed: "pay182", anchor: asOf }, null, asOf);
  return {
    asOf,
    accounts: [CHECKING, SAVINGS],
    transactions: rows.map((t) => ({
      id: t.transaction_id,
      accountId: t.account_id.endsWith("savings") ? SAVINGS.id : CHECKING.id,
      plaidTransactionId: t.transaction_id,
      date: t.date,
      amountCents: Math.round(t.amount * 100),
      description: t.name,
      merchantName: t.merchant_name ?? null,
      pfcPrimary: t.personal_finance_category?.primary ?? null,
      pfcDetailed: t.personal_finance_category?.detailed ?? null,
      categorySource: "plaid",
    })),
    recurringStreams: [],
  };
}

describe("the demo bank", () => {
  it("finds the 1st-and-15th payroll and never the $1.02 of interest", () => {
    const data = demoInput("2026-10-18");
    const schedules = paySchedules(data);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ frequency: "SEMI_MONTHLY", days: [1, 15] });
    // The demo bank posts on weekends too, so Sunday November 1st stays the 1st.
    expect(nextPayday(data, 31)).toMatchObject({ date: "2026-11-01", amountCents: 245_000 });
    // Interest still counts as money coming in, but never as a payday.
    const income = expectedIncome(data, "2026-11-30");
    expect(income.filter((i) => i.amountCents === 245_000).map((i) => i.date)).toEqual([
      "2026-11-01",
      "2026-11-15",
    ]);
    expect(income.some((i) => i.amountCents === 102 && i.date === "2026-10-28")).toBe(true);
  });
});
