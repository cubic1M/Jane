import { describe, expect, it } from "vitest";
import { incomeReply, type IncomeFacts } from "./replies-income";

// The backup chat's answer to what they make (./replies-income.ts): the profile's month and the tax
// cards' year, as the pages give them.

const S5: IncomeFacts = {
  monthCents: 134_333,
  told: false,
  schedules: [
    {
      employer: "Univ Of California",
      frequency: "BIWEEKLY",
      paycheckCents: 62_000,
      monthCents: 134_333,
      extraCents: 0,
    },
  ],
  months: 1,
  yearGrossCents: 2_095_595,
  taxYear: 2026,
  statementsEnd: null,
};

describe("what you make", () => {
  it("gives a month by the pay schedule, and says one month of data is an estimate", () => {
    expect(incomeReply("month", S5).body).toBe(
      "You take home about $1,343.33 a month: $620.00 every two weeks from Univ Of California, 26 paychecks a year. It's from 1 month of data, so it's an estimate.",
    );
  });

  it("gives a year take-home and before tax, the tax cards' figure", () => {
    expect(incomeReply("year", S5).body).toBe(
      "You take home about $16,119.96 a year ($1,343.33 a month: $620.00 every two weeks from Univ Of California, 26 paychecks a year), about $20,955.95 before tax for 2026, the figure the tax cards use. It's from 1 month of data, so it's an estimate.",
    );
  });

  it("uses what they told Jane", () => {
    expect(incomeReply("month", { ...S5, told: true, schedules: [] }).body).toBe(
      "You told me you take home $1,343.33 a month, so that's what I use.",
    );
  });

  it("says when statements that ended long ago are what it's from", () => {
    const body = incomeReply("month", { ...S5, months: 3, statementsEnd: "2026-09-28" }).body;
    expect(body).toMatch(/That's from your statements, which end Sep 28\.$/);
  });

  it("says plainly when no pay is seen, rather than answering another question", () => {
    expect(incomeReply("month", { ...S5, monthCents: null, schedules: [] }).body).toMatch(
      /^I don't see regular pay coming in yet, so I can't say what you make\./,
    );
  });

  it("links to the working, not a page the beta hides", () => {
    expect(incomeReply("month", S5).actions).toEqual([
      expect.objectContaining({ href: "/figures/monthly_income" }),
    ]);
  });
});
