import { describe, expect, it } from "vitest";
import {
  dependantsFromHousehold,
  dependantsWords,
  findTaxFacts,
  guessFilingStatus,
  incomeLine,
  listOf,
  taxProfileView,
  workingProfile,
  type ProfileTransaction,
  type StoredTaxProfile,
} from "./tax-profile";

const tx = (
  pfcDetailed: string,
  amountCents: number,
  description: string,
  date = "2026-09-01",
  merchantName: string | null = null,
): ProfileTransaction => ({ date, amountCents, pfcDetailed, description, merchantName });

const PAY = [
  tx("INCOME_SALARY", -245_000, "ACME CORP PAYROLL", "2026-09-01"),
  tx("INCOME_SALARY", -245_000, "ACME CORP PAYROLL", "2026-09-15"),
];

const facts = (
  transactions: ProfileTransaction[],
  extra: Partial<Parameters<typeof findTaxFacts>[0]> = {},
) => findTaxFacts({ transactions, accounts: [], settingsState: null, newBaby: false, ...extra });

const stored = (s: Partial<StoredTaxProfile>): StoredTaxProfile => ({
  filingStatus: null,
  childrenUnder17: null,
  otherDependants: null,
  state: null,
  incomeKinds: [],
  answered: [],
  ...s,
});

describe("findTaxFacts", () => {
  it("finds wages from two paychecks, with the payer", () => {
    expect(facts(PAY).income).toEqual([
      { kind: "w2", from: ["ACME CORP PAYROLL"], totalCents: 490_000 },
    ]);
  });

  it("needs two paychecks before it calls something wages", () => {
    expect(facts(PAY.slice(0, 1)).income).toEqual([]);
  });

  it("counts one-off freelance, rental and pension income from the first payment", () => {
    const found = facts([
      tx("INCOME_GIG_ECONOMY", -40_000, "UPWORK ESCROW", "2026-08-01", "Upwork"),
      tx("INCOME_RENTAL", -150_000, "ZELLE FROM TENANT"),
      tx("INCOME_RETIREMENT_PENSION", -90_000, "CALPERS"),
      tx("INCOME_UNEMPLOYMENT", -50_000, "EDD UI"),
    ]).income.map((i) => [i.kind, i.from]);
    expect(found).toEqual([
      ["self_employed", ["Upwork"]],
      ["rental", ["ZELLE FROM TENANT"]],
      ["retirement", ["CALPERS"]],
      ["unemployment", ["EDD UI"]],
    ]);
  });

  it("ignores money going out under an income category (a reversal)", () => {
    expect(facts([tx("INCOME_CONTRACTOR", 5_000, "STRIPE REVERSAL")]).income).toEqual([]);
  });

  it("sees investment income from a taxable account even before any dividend", () => {
    const found = facts([tx("INCOME_INTEREST_EARNED", -102, "INTEREST PAYMENT")], {
      accounts: [
        { name: "Demo Brokerage", type: "investment", subtype: "brokerage" },
        { name: "Demo 401(k)", type: "investment", subtype: "401k" },
      ],
    }).income;
    expect(found).toEqual([
      { kind: "investment", from: ["Demo Brokerage", "INTEREST PAYMENT"], totalCents: 102 },
    ]);
  });

  it("leaves retirement accounts out", () => {
    const found = facts([], {
      accounts: [{ name: "IRA", type: "investment", subtype: "ira" }],
    });
    expect(found.income).toEqual([]);
  });

  it("names the payers most paid first, at most two", () => {
    const found = facts([
      tx("INCOME_CONTRACTOR", -10_000, "A"),
      tx("INCOME_CONTRACTOR", -30_000, "B"),
      tx("INCOME_CONTRACTOR", -20_000, "C"),
    ]).income[0];
    expect(found.from).toEqual(["B", "C"]);
  });

  it("takes the state from settings first, else a state agency payment", () => {
    const dmv = tx(
      "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
      21_200,
      "CA DMV VEHICLE REGISTRATION",
      "2026-05-01",
      "California DMV",
    );
    expect(facts([dmv]).state).toEqual({ code: "CA", from: "a California DMV payment" });
    expect(facts([dmv], { settingsState: "OR" }).state).toEqual({
      code: "OR",
      from: "your settings",
    });
    // "ZZ" isn't a state; groceries aren't an agency.
    expect(facts([{ ...dmv, description: "ZZ DMV" }]).state).toBeNull();
    expect(facts([tx("FOOD_AND_DRINK_GROCERIES", 100, "CA MARKET")]).state).toBeNull();
  });

  it("hints at children from childcare or a new-baby checklist, never more", () => {
    expect(facts([]).childrenHint).toBe(false);
    expect(facts([tx("GENERAL_SERVICES_CHILDCARE", 80_000, "BRIGHT HORIZONS")]).childrenHint).toBe(
      true,
    );
    expect(facts([], { newBaby: true }).childrenHint).toBe(true);
  });
});

describe("taxProfileView", () => {
  const found = facts(PAY, { settingsState: "CA" });

  it("shows what Jane found as found, and asks in order", () => {
    const view = taxProfileView(null, found);
    expect(view.incomeKinds).toMatchObject({ status: "found", value: ["w2"] });
    expect(view.state).toEqual({ status: "found", value: "CA", from: "your settings" });
    expect(view.filingStatus.status).toBe("missing");
    expect(view.dependants.status).toBe("missing");
    expect(view.next).toBe("incomeKinds");
    expect(view.complete).toBe(false);
  });

  it("an answer always wins over what Jane found", () => {
    const view = taxProfileView(
      stored({ state: "NV", incomeKinds: [], answered: ["state", "incomeKinds"] }),
      found,
    );
    expect(view.state).toMatchObject({ status: "yours", value: "NV" });
    expect(view.incomeKinds).toMatchObject({ status: "yours", value: [] });
  });

  it("is complete once every field is answered", () => {
    const view = taxProfileView(
      stored({
        filingStatus: "married_joint",
        childrenUnder17: 2,
        otherDependants: 0,
        state: "CA",
        incomeKinds: ["w2"],
        answered: ["filingStatus", "dependants", "state", "incomeKinds"],
      }),
      found,
    );
    expect(view.complete).toBe(true);
    expect(view.next).toBeNull();
    expect(view.newIncome).toEqual([]);
  });

  it("a value without its answer doesn't count", () => {
    const view = taxProfileView(stored({ filingStatus: "single" }), found);
    expect(view.filingStatus.status).toBe("missing");
  });

  it("an unknown filing status doesn't count", () => {
    const view = taxProfileView(
      stored({ filingStatus: "widowed", answered: ["filingStatus"] }),
      found,
    );
    expect(view.filingStatus).toEqual({ status: "missing", value: null });
  });

  it("lists income seen after the person answered", () => {
    const more = facts([...PAY, tx("INCOME_GIG_ECONOMY", -5_000, "DOORDASH DASHER")]);
    const view = taxProfileView(stored({ incomeKinds: ["w2"], answered: ["incomeKinds"] }), more);
    expect(view.newIncome.map((i) => i.kind)).toEqual(["self_employed"]);
  });
});

describe("workingProfile", () => {
  const view = taxProfileView(
    stored({ filingStatus: "single", answered: ["filingStatus"] }),
    facts(PAY, { settingsState: "CA" }),
  );

  it("uses what Jane found only when the autopilot level lets it, and says so", () => {
    expect(workingProfile(view, true)).toEqual({
      filingStatus: "single",
      childrenUnder17: 0,
      otherDependants: 0,
      state: "CA",
      incomeKinds: ["w2"],
      unconfirmed: ["incomeKinds", "state"],
    });
    expect(workingProfile(view, false)).toMatchObject({
      state: null,
      incomeKinds: [],
      unconfirmed: [],
    });
  });
});

describe("wording", () => {
  it("says where income was seen and on which form", () => {
    expect(incomeLine({ kind: "w2", from: ["ACME CORP PAYROLL"], totalCents: 1 })).toBe(
      "wages from ACME CORP PAYROLL (W-2)",
    );
    expect(listOf(["a"])).toBe("a");
    expect(listOf(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("how a couple is estimated before they say how they file (taxes QA)", () => {
  it("guesses married filing jointly from a joint account or two employers, and says why", () => {
    expect(
      guessFilingStatus({
        jointAccounts: 1,
        payrollNames: ["SPRINGFIELD SCHOOLS PAYROLL", "NORTHWIND HEALTH PAYROLL"],
      }),
    ).toEqual({
      status: "married_joint",
      why: "a joint account and two employers' paychecks",
    });
    expect(guessFilingStatus({ jointAccounts: 1, payrollNames: [] })?.why).toBe("a joint account");
  });

  it("guesses nothing for one person with one employer", () => {
    expect(
      guessFilingStatus({
        jointAccounts: 0,
        payrollNames: ["ACME CORP PAYROLL", "ACME CORP PAYROLL PPD"],
      }),
    ).toBeNull();
  });
});

// The children in the household listed for insurance, offered as the person's dependants
// (area plan walk: a family paying $16,500 of childcare was estimated with none).
describe("dependants Jane finds", () => {
  const household = [
    { relation: "spouse", age: 40 },
    { relation: "child", age: 4 },
    { relation: "child", age: null },
    { relation: "child", age: 19 },
  ];

  it("counts children under 17 (an age not given counts) and older ones as other", () => {
    expect(dependantsFromHousehold(household)).toEqual({
      childrenUnder17: 2,
      otherDependants: 1,
      from: "the household on your insurance page",
    });
    expect(dependantsFromHousehold([{ relation: "spouse", age: 40 }])).toBeNull();
    expect(dependantsWords(2, 1)).toBe("2 children under 17 and 1 other dependant");
    expect(dependantsWords(1, 0)).toBe("1 child under 17");
  });

  it("shows them as found until answered, and counts them only when found answers are used", () => {
    const view = taxProfileView(null, facts(PAY, { household }));
    expect(view.dependants).toMatchObject({
      status: "found",
      childrenUnder17: 2,
      otherDependants: 1,
      from: "the household on your insurance page",
    });
    expect(workingProfile(view, true)).toMatchObject({ childrenUnder17: 2, otherDependants: 1 });
    expect(workingProfile(view, false)).toMatchObject({ childrenUnder17: 0, otherDependants: 0 });
    expect(workingProfile(view, true).unconfirmed).toContain("dependants");
    // An answer wins.
    const answered = taxProfileView(
      stored({ childrenUnder17: 1, otherDependants: 0, answered: ["dependants"] }),
      facts(PAY, { household }),
    );
    expect(answered.dependants).toMatchObject({ status: "yours", childrenUnder17: 1 });
  });
});
