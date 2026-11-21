import { describe, expect, it } from "vitest";
import { DETECTOR_RATES } from "@/config/detectors";
import { yearIncomeOf } from "@/detectors/helpers";
import { CHECKING, input, tx } from "@/detection/__fixtures__/build";
import { unevenPay } from "@/detection/forecast";
import { buildProfile, type ProfileInput } from "./build";

// Debug 2, sweep 13 (Plaid one month, linked): two paychecks of $688.40 every two weeks are too few
// for a schedule, and with no new data the profile's month went $1,376.80 on Nov 20 to $1,351.82 on
// Nov 21 (the Saver's Credit's income $21,478.08 to $21,088.39), paced to today, while Home's "about
// this a month" read $1,377. One month for such pay, spread between the data's lines (manager, 11-21):
// data Oct 22 to Nov 14 is 24 days, under a month, so a month of pay is the $1,376.80 that came in.

const PAY = 68_840;
const lines = [
  { date: "2026-10-22", amountCents: 650, description: "STARBUCKS", pfc: "FOOD_AND_DRINK_COFFEE" },
  {
    date: "2026-10-31",
    amountCents: -PAY,
    description: "UC DAVIS PAYROLL PPD",
    pfc: "INCOME_WAGES",
  },
  { date: "2026-11-03", amountCents: 87_500, description: "RENT", pfc: "RENT_AND_UTILITIES_RENT" },
  {
    date: "2026-11-14",
    amountCents: -PAY,
    description: "UC DAVIS PAYROLL PPD",
    pfc: "INCOME_WAGES",
  },
];
const profileOn = (today: string): ProfileInput => ({
  today,
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 42_055 }],
  liabilities: [],
  told: {},
  transactions: lines.map((l) => ({ ...l, accountId: "chk" })),
});
const homeOn = (asOf: string) =>
  unevenPay(
    input({
      asOf,
      accounts: [{ ...CHECKING, currentBalanceCents: 42_055 }],
      transactions: lines.map((l) =>
        tx({
          date: l.date,
          amountCents: l.amountCents,
          description: l.description,
          pfcPrimary: l.pfc.startsWith("INCOME") ? "INCOME" : l.pfc.split("_")[0],
          pfcDetailed: l.pfc,
        }),
      ),
    }),
    CHECKING.id,
  );
const read = (today: string) => {
  const data = profileOn(today);
  const profile = buildProfile(data);
  return {
    home: homeOn(today),
    month: profile.facts.monthly_income.value,
    year: yearIncomeOf(profile, data),
  };
};

describe("pay too sparse for a schedule, read on two days with no new data", () => {
  it("is one month, the same on Home and the profile, and the same year, on Nov 20 and Nov 26", () => {
    const month = 2 * PAY;
    const year = Math.round(month * 12 * DETECTOR_RATES.tax.netToGross);
    expect(read("2026-11-20")).toEqual({ home: month, month, year });
    expect(read("2026-11-26")).toEqual({ home: month, month, year });
  });
});
