import { describe, expect, it } from "vitest";
import { CHECKING, SAVINGS, tx } from "./__fixtures__/build";
import { expectedPaydays, missedPaydays } from "./paydays";
import type { DetectionInput } from "./types";

const PAYROLL = {
  description: "ACME CORP PAYROLL",
  pfcPrimary: "INCOME",
  pfcDetailed: "INCOME_SALARY",
};

// Pay every two weeks, 900 into checking and 1,100 into savings (savings is the larger share).
const DATES = ["2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25", "2026-10-09"];
const rows = DATES.flatMap((date) => [
  tx({ ...PAYROLL, date, amountCents: -90_000 }),
  tx({ ...PAYROLL, date, accountId: SAVINGS.id, amountCents: -110_000 }),
]);

const input = (asOf: string, checkingSeen: string, savingsSeen: string): DetectionInput => ({
  asOf,
  accounts: [
    { ...CHECKING, balanceAsOf: checkingSeen },
    { ...SAVINGS, balanceAsOf: savingsSeen },
  ],
  transactions: rows,
  recurringStreams: [],
});

describe("a paycheck share is judged by its own account's last seen day", () => {
  it("expects the checking share of overdue pay when only savings (the larger share) is behind", () => {
    const data = input("2026-10-24", "2026-10-24", "2026-10-22");
    const [pay] = expectedPaydays(data, "2026-10-30");
    expect(pay).toMatchObject({ dueOn: "2026-10-23", date: "2026-10-24" });
    expect(pay!.shares).toEqual([{ accountId: CHECKING.id, amountCents: 90_000 }]);
    expect(pay!.amountCents).toBe(90_000);
  });

  it("calls the checking share missed once the wait is over, though savings is not seen that far", () => {
    const data = input("2026-10-28", "2026-10-28", "2026-10-22");
    const [missed] = missedPaydays(data);
    expect(missed).toMatchObject({ dueOn: "2026-10-23" });
    expect(missed!.shares).toEqual([{ accountId: CHECKING.id, amountCents: 90_000 }]);
  });

  it("still leaves out overdue pay when no account that got a share is seen that far", () => {
    const data = input("2026-10-24", "2026-10-22", "2026-10-22");
    expect(expectedPaydays(data, "2026-10-30").filter((p) => p.dueOn === "2026-10-23")).toEqual([]);
  });
});
