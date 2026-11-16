import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "./build";
import { inputFor } from "./sample";

// Gate C's calendar sweep, 11-16: who pays the person was counted back from today, while whether
// a paycheck stopped is counted back from where the data ends. With a bank that hadn't synced
// for six weeks, the employer and the earners became "not known yet", and the suggestions built
// on them (loan forgiveness for a public employer, work's insurance) went with them.

// Paid on the 1st and the 15th through Oct 15; the data ends Oct 24.
const paydays = Array.from({ length: 20 }, (_, i) => {
  const month = Math.floor(i / 2) + 1;
  return `2026-${String(month).padStart(2, "0")}-${i % 2 ? "15" : "01"}`;
});

const on = (today: string): ProfileInput => {
  const base = inputFor("renter");
  return {
    ...base,
    today,
    transactions: [
      ...paydays.map((date) => ({
        date,
        amountCents: -250_000,
        description: "SPRINGFIELD SCHOOLS PAYROLL",
        pfc: "INCOME_SALARY",
        accountId: base.accounts[0].id,
      })),
      {
        date: "2026-10-24",
        amountCents: 4_500,
        description: "CORNER GROCERY",
        pfc: "FOOD_AND_DRINK_GROCERIES",
        accountId: base.accounts[0].id,
      },
    ],
  };
};

const work = (today: string) => {
  const { facts } = buildProfile(on(today));
  return [facts.employer.value, facts.employer.source, facts.earners.value];
};

describe("who pays the person, with data that stopped coming in", () => {
  it("is the same two months after the last sync as the week after it", () => {
    expect(paydays.at(-1)).toBe("2026-10-15");
    const soon = work("2026-10-25");
    expect(soon).toEqual(["SPRINGFIELD SCHOOLS", "seen", 1]);
    expect(work("2026-12-05")).toEqual(soon);
    expect(work("2026-12-24")).toEqual(soon);
  });
});
