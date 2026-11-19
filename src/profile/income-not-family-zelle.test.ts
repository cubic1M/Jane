import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "./build";
import { inputFor } from "./sample";

// Gate B, 11-18 (the chat tests' run of the desktop walk's S6 upload): "What is my income?" was
// "about $1,759 a month … from your salary at UNIV OF CALIF", the profile's own figure, where pay was
// about $1,350. A monthly $400 Zelle from family is filed as other income (regular payers, for a
// tenant's rent) and was added to pay; the tax estimate leaves it out as income it can't place.
// Money coming in each month counts what the tax estimate counts: the paychecks, not the Zelle.

const base = inputFor("renter");
const account = base.accounts[0]!.id;
const row = (date: string, amountCents: number, description: string, pfc: string) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: account,
});

// Paid $620 every two weeks from Univ of Calif, Jan 9 to Nov 13, 2026, and $400 by Zelle from
// family on the 3rd of each month from February; groceries most weeks, read on Nov 14.
const paydays = Array.from({ length: 23 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 9) + i * 14 * 86_400_000).toISOString().slice(0, 10),
);
const months = ["02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];
const person = (withZelle: boolean): ProfileInput => ({
  ...base,
  today: "2026-11-14",
  transactions: [
    ...paydays.map((d) => row(d, -62_000, "UNIV OF CALIF PAYROLL PPD", "INCOME_SALARY")),
    ...(withZelle
      ? months.map((m) => row(`2026-${m}-03`, -40_000, "ZELLE FROM RIVERA MARIA", "INCOME_OTHER"))
      : []),
    ...paydays.map((d) => row(d, 6_400, "SAFEWAY STORE", "FOOD_AND_DRINK_GROCERIES")),
  ],
});

describe("money coming in each month", () => {
  it("is the paychecks, not a monthly Zelle from family", () => {
    const withZelle = buildProfile(person(true)).facts;
    const payOnly = buildProfile(person(false)).facts;
    expect(withZelle.monthly_income.value).toBe(payOnly.monthly_income.value);
    // About $1,400 a month: 23 paychecks of $620 over the ten months from the first (main counted
    // the Zelle too: about $1,793).
    expect(withZelle.monthly_income.value as number).toBeGreaterThan(135_000);
    expect(withZelle.monthly_income.value as number).toBeLessThan(145_000);
    expect(withZelle.employer.value).toBe(payOnly.employer.value);
  });

  it("still counts a pay word's money in, even by Zelle", () => {
    // A client paying by Zelle is filed as contractor pay, not other income: still counted.
    const client = buildProfile({
      ...person(false),
      transactions: [
        ...person(false).transactions,
        ...months.map((m) =>
          row(`2026-${m}-20`, -50_000, "ZELLE FROM ACME DESIGN", "INCOME_CONTRACTOR"),
        ),
      ],
    }).facts;
    expect(client.monthly_income.value as number).toBeGreaterThan(
      buildProfile(person(false)).facts.monthly_income.value as number,
    );
  });
});
