import { describe, expect, it } from "vitest";
import { stoppedEmployer } from "./stopped-employer";

const pay = (date: string, description: string) => ({
  date,
  amountCents: -200_000,
  description,
  pfc: "INCOME_SALARY",
});
const DAYS = ["01-09", "02-06", "03-06", "04-03", "05-01", "06-05"];

describe("the employer whose paychecks stopped", () => {
  it("reads one employer however the bank writes the line, going by where the data ends", () => {
    const job = DAYS.map((d, i) =>
      pay(`2026-${d}`, i % 2 ? "ACH CREDIT NORTHWIND PAYROLL" : "NORTHWIND PAYROLL"),
    );
    const later = { date: "2026-10-20", amountCents: 5_000, description: "KROGER", pfc: null };
    expect(stoppedEmployer({ transactions: [...job, later] })).toEqual({
      name: "NORTHWIND",
      lastDay: "2026-06-05",
      paychecks: 6,
    });
    // The data ending in June: an old statement, not a lost job.
    expect(stoppedEmployer({ transactions: job })).toBeNull();
  });
});
