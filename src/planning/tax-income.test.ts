import { describe, expect, it } from "vitest";
import { DEMO_PAY_STUB } from "@/config/tax";
import { demoPayroll } from "@/lib/payroll/demo";
import {
  otherIncomeSoFar,
  payFrequency,
  payFromStubs,
  payFromYtd,
  paychecksLeft,
  projectOther,
  taxPaymentsFor,
  yearElapsed,
  type IncomeTransaction,
} from "./tax-income";
import { balancePhrase } from "./tax-estimate-copy";

// Spec step 120: the year's income for the estimate, so far and projected.

const semiMonthly = (months: number) =>
  Array.from({ length: months }, (_, m) =>
    [1, 15].map((d) => `2026-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`),
  ).flat();

describe("pay frequency", () => {
  it("tells twice a month from every two weeks", () => {
    expect(payFrequency(semiMonthly(10))).toEqual({ perYear: 24, label: "twice a month" });
    const fortnightly = Array.from({ length: 21 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 2) + i * 14 * 86_400_000).toISOString().slice(0, 10),
    );
    expect(payFrequency(fortnightly)).toEqual({ perYear: 26, label: "every two weeks" });
  });

  it("knows weekly and monthly, and needs two paydays", () => {
    expect(payFrequency(["2026-01-02", "2026-01-09", "2026-01-16"])?.perYear).toBe(52);
    expect(payFrequency(["2026-01-31", "2026-02-28", "2026-03-31"])?.perYear).toBe(12);
    expect(payFrequency(["2026-01-31"])).toBeNull();
  });

  it("counts the paydays left in the year", () => {
    expect(paychecksLeft("2026-10-15", 24)).toBe(4);
    expect(paychecksLeft("2026-10-01", 24)).toBe(5);
    expect(paychecksLeft("2026-10-31", 12)).toBe(2);
    expect(paychecksLeft("2026-12-18", 52)).toBe(1);
  });
});

describe("pay stubs", () => {
  const deposits = semiMonthly(10).map((date) => ({ date, amountCents: 245_000, payer: "ACME" }));
  const stubs = demoPayroll.payStubs(deposits);

  it("the demo stand-in's stub adds up to the deposit", () => {
    expect(stubs[0]).toMatchObject({
      grossCents: 395_000,
      netCents: 245_000,
      federalWithheldCents: 56_557,
    });
    const out =
      DEMO_PAY_STUB.retirementCents +
      DEMO_PAY_STUB.otherPretaxCents +
      DEMO_PAY_STUB.federalWithheldCents +
      DEMO_PAY_STUB.stateWithheldCents +
      DEMO_PAY_STUB.socialSecurityCents +
      DEMO_PAY_STUB.medicareCents +
      DEMO_PAY_STUB.stateDisabilityCents;
    expect(DEMO_PAY_STUB.grossCents - out).toBe(DEMO_PAY_STUB.netCents);
    // A smaller deposit scales the stub.
    expect(
      demoPayroll.payStubs([{ date: "2026-01-01", amountCents: 122_500, payer: "ACME" }])[0]
        .grossCents,
    ).toBe(197_500);
  });

  it("projects the rest of the year's paychecks like the average", () => {
    const pay = payFromStubs(stubs, 2026, "2026-10-18");
    expect(pay.soFar.grossCents).toBe(20 * 395_000);
    expect(pay.projected.grossCents).toBe(24 * 395_000);
    expect(pay.projected.wagesCents).toBe(24 * (395_000 - 23_700 - 14_500));
    expect(pay.projected.socialSecurityWagesCents).toBe(24 * (395_000 - 14_500));
    expect(pay).toMatchObject({
      perYear: 24,
      frequency: "twice a month",
      asOf: "2026-10-15",
      employers: ["ACME"],
    });
    // A finished year isn't projected.
    expect(payFromStubs(stubs, 2026, "2027-02-01").projected.grossCents).toBe(20 * 395_000);
  });

  it("projects the person's own year-to-date figures at the same pace", () => {
    const pay = payFromYtd(
      {
        asOf: "2026-07-02",
        grossCents: 5_000_000,
        federalCents: 600_000,
        stateCents: 200_000,
        retirementCents: 300_000,
        pretaxCents: 100_000,
      },
      2026,
      "2026-10-18",
    );
    expect(pay.source).toBe("pay_stub");
    expect(pay.soFar.wagesCents).toBe(4_600_000);
    // July 2 is 182 days of 365 gone.
    expect(pay.projected.grossCents).toBe(Math.round(5_000_000 / (182 / 365)));
    // Last year's stub doesn't count for this year.
    expect(
      payFromYtd(
        {
          asOf: "2025-12-31",
          grossCents: 1,
          federalCents: 0,
          stateCents: 0,
          retirementCents: 0,
          pretaxCents: 0,
        },
        2026,
        "2026-10-18",
      ).projected.grossCents,
    ).toBe(0);
  });
});

const tx = (o: Partial<IncomeTransaction>): IncomeTransaction => ({
  date: "2026-03-01",
  amountCents: -10_000,
  pfcDetailed: "INCOME_CONTRACTOR",
  description: "CLIENT",
  merchantName: null,
  ...o,
});

describe("other income", () => {
  it("adds freelance, interest, dividends, rent, pensions and unemployment, less business costs", () => {
    const income = otherIncomeSoFar(
      [
        tx({}),
        tx({ pfcDetailed: "INCOME_GIG_ECONOMY", amountCents: -5_000 }),
        tx({ pfcDetailed: "INCOME_INTEREST_EARNED", amountCents: -102 }),
        tx({ pfcDetailed: "INCOME_DIVIDENDS", amountCents: -2_000 }),
        tx({ pfcDetailed: "INCOME_RENTAL", amountCents: -150_000 }),
        tx({ pfcDetailed: "INCOME_RETIREMENT_PENSION", amountCents: -90_000 }),
        tx({ pfcDetailed: "INCOME_UNEMPLOYMENT", amountCents: -40_000 }),
        tx({ date: "2025-12-01" }),
        tx({ pfcDetailed: "INCOME_SALARY", amountCents: -245_000 }),
      ],
      [
        { date: "2026-03-28", amountCents: -1_500, subtype: "dividend" },
        { date: "2026-03-28", amountCents: -1_000, subtype: "qualified dividend" },
        { date: "2026-03-28", amountCents: -300, subtype: "interest" },
        { date: "2026-03-28", amountCents: 100_000, subtype: "contribution" },
      ],
      2026,
      3_000,
    );
    expect(income).toEqual({
      selfEmploymentCents: 12_000,
      interestCents: 402,
      dividendsCents: 4_500,
      qualifiedDividendsCents: 1_000,
      shortTermGainsCents: 0,
      longTermGainsCents: 0,
      rentalCents: 150_000,
      retirementCents: 90_000,
      unemploymentCents: 40_000,
    });
    expect(projectOther(income, 2026, "2026-07-02").rentalCents).toBe(
      Math.round(150_000 / (182 / 365)),
    );
    expect(projectOther(income, 2026, "2027-01-02").rentalCents).toBe(150_000);
  });

  it("finds estimated tax paid toward the year, federal and state", () => {
    const pay = (date: string, description: string, amountCents = 100_000) =>
      tx({ date, description, amountCents, pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" });
    expect(
      taxPaymentsFor(
        [
          pay("2026-04-15", "IRS USATAXPYMT"),
          pay("2026-06-15", "FRANCHISE TAX BD PAYMENTS", 30_000),
          pay("2027-01-15", "IRS USATAXPYMT"),
          // January's is last year's last quarter.
          pay("2026-01-15", "IRS USATAXPYMT"),
          pay("2027-02-15", "IRS USATAXPYMT"),
        ],
        2026,
      ),
    ).toEqual({ federalCents: 200_000, stateCents: 30_000 });
  });

  it("knows how much of the year has gone", () => {
    expect(yearElapsed(2026, "2026-01-01")).toBe(0);
    expect(yearElapsed(2026, "2027-01-01")).toBe(1);
    expect(yearElapsed(2026, "2026-07-02")).toBeCloseTo(0.4986, 3);
  });
});

describe("how the estimate is said", () => {
  it("always says about, rounds to dollars and calls small balances even", () => {
    expect(balancePhrase(416_637)).toBe("a refund of about $4,166");
    expect(balancePhrase(-120_049)).toBe("about $1,200 to pay");
    expect(balancePhrase(3_000)).toBe("about even");
  });
});
