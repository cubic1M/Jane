import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { runDetectors } from "./index";

// Debug 3's calendar sweep (11-19, the renter, frozen data read 40 days after its last sync): the
// student loan plan card went "save $760 a year", "$752", "$749" on consecutive days, its year of
// pay $38,678.77, then $38,918.27, with nothing new in the data. The year of paychecks was counted
// back from today, so each day could drop an old paycheck. Counted back from where the statements
// end, it holds until a new one comes.

const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Fourteen months of pay every two weeks to Jan 22, 2027, and $160 to the loan each month.
const paydays = Array.from({ length: 31 }, (_, i) => addDays("2025-11-21", i * 14));
const months = Array.from({ length: 14 }, (_, i) =>
  new Date(Date.UTC(2025, 11 + i, 5)).toISOString().slice(0, 10),
);
const data = (today: string, extra: ProfileTx[] = []): ProfileInput => ({
  today,
  accounts: [
    { id: "chk", type: "depository", subtype: "checking", balanceCents: 300_000 },
    { id: "ln", type: "loan", subtype: "student", balanceCents: 2_400_000 },
  ],
  liabilities: [
    { accountId: "ln", kind: "student", aprBps: 550, hasPmi: null, payoffDate: "2036-05-01" },
  ],
  told: {},
  transactions: [
    ...paydays.map((d, i) =>
      tx(d, -(150_000 + (i % 3) * 1_000), "ACME CORP PAYROLL", "INCOME_WAGES"),
    ),
    ...months.map((d) =>
      tx(d, 16_000, "NELNET STUDENT LN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
    ),
    tx("2027-01-28", 4_200, "SAFEWAY #1234", "FOOD_AND_DRINK_GROCERIES"),
    ...extra,
  ],
});
const card = (input: ProfileInput) =>
  runDetectors({ profile: buildProfile(input), data: input }).find(
    (s) => s.topic === "student_repayment",
  );

describe("the student loan plan card on frozen data", () => {
  // Mar 14, 2027 is the first day a year back from today leaves out the Mar 13, 2026 paycheck.
  it("says the same on four days in a row", () => {
    const days = ["2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15"].map((d) => card(data(d)));
    expect(days[0]).toBeDefined();
    for (const d of days) {
      expect(d?.worthCents).toBe(days[0]!.worthCents);
      expect(d?.why).toBe(days[0]!.why);
    }
  });

  it("moves when a new paycheck comes in", () => {
    const before = card(data("2027-03-12"));
    const after = card(
      data("2027-03-12", [tx("2027-02-05", -400_000, "ACME CORP PAYROLL", "INCOME_WAGES")]),
    );
    expect(after?.why).not.toBe(before?.why);
  });
});
