import { describe, expect, it } from "vitest";
import { CHECKING, SAVINGS, tx } from "./__fixtures__/build";
import { expectedIncome } from "./forecast";
import { paySchedules } from "./paydays";
import type { DetectionInput } from "./types";

const PAYROLL = {
  description: "ACME CORP PAYROLL",
  pfcPrimary: "INCOME",
  pfcDetailed: "INCOME_SALARY",
};

const input = (asOf: string, transactions: ReturnType<typeof tx>[]): DetectionInput => ({
  asOf,
  accounts: [CHECKING, SAVINGS],
  transactions,
  recurringStreams: [],
});

describe("fitting a schedule counts a banking day early as on time", () => {
  it("fits weekly Monday pay when the third check posted the Friday before", () => {
    // Mon Apr 6, Mon Apr 13, then Monday the 20th posted Friday the 17th (a banking day early).
    const data = input(
      "2026-04-21",
      ["2026-04-06", "2026-04-13", "2026-04-17"].map((date) =>
        tx({ ...PAYROLL, date, amountCents: -90_000 }),
      ),
    );
    expect(paySchedules(data)[0]).toMatchObject({ frequency: "WEEKLY" });
  });
});

describe("a paycheck split between accounts keeps each account's share", () => {
  it("projects 1,800 into checking and 200 into savings, not 2,000 into one", () => {
    const rows = ["2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25", "2026-10-09"].flatMap(
      (date) => [
        tx({ ...PAYROLL, date, amountCents: -180_000 }),
        tx({ ...PAYROLL, date, accountId: SAVINGS.id, amountCents: -20_000 }),
      ],
    );
    const data = input("2026-10-12", rows);
    const [schedule] = paySchedules(data);
    expect(schedule.amountCents).toBe(200_000);
    const next = expectedIncome(data, "2026-10-24").filter((e) => e.date === "2026-10-23");
    expect(next.map((e) => [e.accountId, e.amountCents]).sort()).toEqual([
      [CHECKING.id, 180_000],
      [SAVINGS.id, 20_000],
    ]);
  });
});
