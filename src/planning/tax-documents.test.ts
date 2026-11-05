import { describe, expect, it } from "vitest";
import { expectedForms, formPayer, type FormTransaction } from "./tax-documents";

// Spec step 119: the tax forms to expect, from payers and lenders.

const tx = (o: Partial<FormTransaction>): FormTransaction => ({
  date: "2026-03-01",
  amountCents: -100_000,
  pfcDetailed: "INCOME_SALARY",
  description: "ACME CORP PAYROLL",
  merchantName: null,
  accountName: "Checking",
  ...o,
});

describe("expectedForms", () => {
  const forms = expectedForms({
    year: 2026,
    transactions: [
      tx({}),
      tx({ date: "2026-04-01" }),
      // Last year's pay doesn't count for 2026.
      tx({ date: "2025-12-15", description: "OLD JOB PAYROLL" }),
      tx({ pfcDetailed: "INCOME_CONTRACTOR", merchantName: "Big Client", amountCents: -250_000 }),
      tx({ pfcDetailed: "INCOME_GIG_ECONOMY", merchantName: "Uber", amountCents: -50_000 }),
      tx({
        pfcDetailed: "INCOME_INTEREST_EARNED",
        description: "INTEREST",
        amountCents: -1_200,
        accountName: "High Yield Savings",
      }),
      tx({
        pfcDetailed: "INCOME_INTEREST_EARNED",
        description: "INTEREST",
        amountCents: -500,
        accountName: "Checking",
      }),
      tx({
        pfcDetailed: "INCOME_UNEMPLOYMENT",
        description: "EDD UI BENEFITS",
        amountCents: -40_000,
      }),
    ],
    accounts: [
      { name: "Brokerage", type: "investment", subtype: "brokerage" },
      { name: "401k", type: "investment", subtype: "401k" },
    ],
    loans: [
      { name: "Home Loan", kind: "mortgage", ytdInterestPaidCents: 1_023_040 },
      { name: "Student Loan", kind: "student", ytdInterestPaidCents: 80_550 },
      { name: "Small Student Loan", kind: "student", ytdInterestPaidCents: 50_000 },
      { name: "Car", kind: "loan", ytdInterestPaidCents: 100_000 },
    ],
  });

  it("expects one form per payer and lender, by the usual date the year after", () => {
    expect(forms.map((f) => [f.key, f.form, f.from, f.by])).toEqual([
      ["w2:acme-corp-payroll", "W-2", "ACME CORP PAYROLL", "2027-01-31"],
      ["nec:big-client", "1099-NEC or 1099-K", "Big Client", "2027-01-31"],
      ["nec:uber", "1099-NEC or 1099-K", "Uber", "2027-01-31"],
      ["g:edd-ui-benefits", "1099-G", "EDD UI BENEFITS", "2027-01-31"],
      ["int:high-yield-savings", "1099-INT", "High Yield Savings", "2027-01-31"],
      ["brokerage:brokerage", "consolidated 1099 (DIV and B)", "Brokerage", "2027-02-15"],
      ["mortgage:home-loan", "1098", "Home Loan", "2027-01-31"],
      ["student:student-loan", "1098-E", "Student Loan", "2027-01-31"],
    ]);
  });

  it("marks a freelance payer under the 2026 threshold ($2,000) as maybe not sending one", () => {
    expect(forms.find((f) => f.key === "nec:big-client")).toMatchObject({
      mayNotSend: false,
      amountCents: 250_000,
    });
    expect(forms.find((f) => f.key === "nec:uber")).toMatchObject({
      mayNotSend: true,
      amountCents: 50_000,
    });
  });

  it("for a past year, still expects the loan interest forms, amount unknown", () => {
    const forms = expectedForms({
      year: 2025,
      transactions: [],
      accounts: [],
      loans: [
        { name: "Home Loan", kind: "mortgage", ytdInterestPaidCents: null },
        { name: "Car", kind: "loan", ytdInterestPaidCents: null },
      ],
    });
    expect(forms).toEqual([
      expect.objectContaining({ key: "mortgage:home-loan", form: "1098", amountCents: null }),
    ]);
  });

  it("uses each year's threshold: $600 for 2025", () => {
    const [form] = expectedForms({
      year: 2025,
      transactions: [
        tx({
          date: "2025-06-01",
          pfcDetailed: "INCOME_CONTRACTOR",
          merchantName: "Uber",
          amountCents: -70_000,
        }),
      ],
      accounts: [],
      loans: [],
    });
    expect(form).toMatchObject({ key: "nec:uber", mayNotSend: false, by: "2026-01-31" });
  });
});

// Spec step 219: an exchange that sold crypto sends a 1099-DA.
describe("the 1099-DA", () => {
  it("is expected from each exchange that sold in the year, with its proceeds", () => {
    const forms = expectedForms({
      year: 2026,
      transactions: [],
      accounts: [],
      loans: [],
      cryptoSales: [{ name: "Demo Exchange", proceedsCents: 2_090_000 }],
    });
    expect(forms).toEqual([
      expect.objectContaining({
        key: "da:demo-exchange",
        form: "1099-DA",
        from: "Demo Exchange",
        by: "2027-02-15",
        amountCents: 2_090_000,
        mayNotSend: false,
      }),
    ]);
    expect(expectedForms({ year: 2026, transactions: [], accounts: [], loans: [] })).toEqual([]);
  });
});

// Debugger 11-02: a homeowner's uploaded checking showed $1,720 a month to Mr. Cooper and $312.44
// to Nelnet, and the tax pack expected no 1098 or 1098-E ("No student loan or mortgage interest
// reported"): only loans a bank reports were read. A lender paid in the year sends one too.
describe("a loan seen only in its payments", () => {
  const pay = (merchantName: string, pfcDetailed: string, date = "2026-03-02") =>
    tx({ merchantName, pfcDetailed, date, amountCents: 172_000 });

  it("expects the lender's 1098 or 1098-E, amount unknown", () => {
    const forms = expectedForms({
      year: 2026,
      transactions: [
        pay("Mr Cooper", "LOAN_PAYMENTS_MORTGAGE_PAYMENT"),
        pay("Mr Cooper", "LOAN_PAYMENTS_MORTGAGE_PAYMENT", "2026-04-02"),
        pay("Nelnet", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
        // Paid last year only: nothing for this year.
        pay("Old Servicer", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", "2025-12-12"),
      ],
      accounts: [],
      loans: [],
    });
    expect(forms.map((f) => [f.key, f.form, f.from, f.amountCents])).toEqual([
      ["mortgage:mr-cooper", "1098", "Mr Cooper", null],
      ["student:nelnet", "1098-E", "Nelnet", null],
    ]);
  });

  it("isn't expected twice when the bank reports that kind of loan", () => {
    const forms = expectedForms({
      year: 2026,
      transactions: [pay("Mr Cooper", "LOAN_PAYMENTS_MORTGAGE_PAYMENT")],
      accounts: [],
      loans: [{ name: "Home Loan", kind: "mortgage", ytdInterestPaidCents: 640_000 }],
    });
    expect(forms.map((f) => f.key)).toEqual(["mortgage:home-loan"]);
  });
});

// Debugger 11-02: the tax pack, the page a person hands their preparer, said "1099-NEC or 1099-K
// from Stripe Transfer" and "W-2 from Blue Bottle Coffee Payroll": the bank's word for how the
// money came, not who sends the form. Pages show formPayer(from); `from` and the key stay as they
// were, since documents, checks and "I have it" are matched by them.
// Debugger 11-04: $79,700 coming in from E*TRADE and no form expected, because an uploaded file
// has no investment account.
describe("a brokerage seen only in money coming from it", () => {
  const fromBroker = (description: string, date = "2026-05-20") =>
    tx({
      description,
      date,
      amountCents: -3_850_000,
      pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
    });
  const forms = (
    transactions: FormTransaction[],
    accounts: Parameters<typeof expectedForms>[0]["accounts"] = [],
  ) =>
    expectedForms({ year: 2026, transactions, accounts, loans: [] }).filter(
      (f) => f.formKey === "brokerage",
    );

  it("expects its form once, by the usual date", () => {
    expect(
      forms([
        fromBroker("ETRADE SECURITIES ACH TRANSFER"),
        fromBroker("ETRADE SECURITIES ACH TRANSFER", "2026-08-20"),
        fromBroker("SCHWAB MONEYLINK"),
      ]).map((f) => [f.key, f.from, f.by, f.mayNotSend]),
    ).toEqual([
      ["brokerage:e-trade", "E*TRADE", "2027-02-15", false],
      ["brokerage:schwab", "Schwab", "2027-02-15", false],
    ]);
  });

  it("ignores other transfers, last year's, and money going to the broker", () => {
    expect(
      forms([
        fromBroker("ONLINE TRANSFER FROM SAVINGS"),
        fromBroker("ETRADE SECURITIES ACH TRANSFER", "2025-12-20"),
        { ...fromBroker("VANGUARD BROKERAGE BUY"), amountCents: 250_000 },
      ]),
    ).toEqual([]);
  });

  it("leaves it to an investment account on file", () => {
    expect(
      forms(
        [fromBroker("ETRADE SECURITIES ACH TRANSFER")],
        [{ name: "E*TRADE brokerage", type: "investment", subtype: "brokerage" }],
      ).map((f) => f.from),
    ).toEqual(["E*TRADE brokerage"]);
  });
});

// Debugger 11-04: "1099-R from Ssa Treas Xxsoc Sec" and "1099-R from Ssi Treas Xxsupp Sec". Social
// Security sends an SSA-1099, and SSI isn't taxed and sends nothing (its category keeps it out).
describe("Social Security", () => {
  it("sends an SSA-1099, once, under its own name", () => {
    const pay = (date: string) =>
      tx({
        date,
        description: "SSA TREAS 310 XXSOC SEC",
        merchantName: "Ssa Treas Xxsoc Sec",
        pfcDetailed: "INCOME_RETIREMENT_PENSION",
        amountCents: -112_400,
      });
    const forms = expectedForms({
      year: 2026,
      transactions: [pay("2026-09-03"), pay("2026-10-03")],
      accounts: [],
      loans: [],
    });
    expect(forms.map((f) => [f.form, f.from, f.amountCents])).toEqual([
      ["SSA-1099", "Social Security", 224_800],
    ]);
  });

  it("leaves a real pension's 1099-R alone", () => {
    const forms = expectedForms({
      year: 2026,
      transactions: [
        tx({
          description: "STATE TEACHERS RET SYS",
          merchantName: "State Teachers Ret Sys",
          pfcDetailed: "INCOME_RETIREMENT_PENSION",
        }),
      ],
      accounts: [],
      loans: [],
    });
    expect(forms.map((f) => f.form)).toEqual(["1099-R"]);
  });
});

// Debugger 11-05: a student paid $13,000 of tuition and the forms to expect had no 1098-T, which is
// what the education credits need.
describe("tuition paid to a school", () => {
  const formsFor = (transactions: FormTransaction[]) =>
    expectedForms({ year: 2026, transactions, accounts: [], loans: [] }).map((f) => [
      f.form,
      f.from,
    ]);
  const paid = (description: string, date = "2026-09-08") =>
    tx({ date, amountCents: 431_000, description, pfcDetailed: "GENERAL_SERVICES_EDUCATION" });

  it("expects one 1098-T from the school, however many times it's paid", () => {
    expect(
      formsFor([
        paid("UNIV OF WASHINGTON TUITION"),
        paid("UNIV OF WASHINGTON TUITION", "2026-01-08"),
      ]),
    ).toEqual([["1098-T", "UNIV OF WASHINGTON"]]);
  });

  it("not from a course app, or for another year", () => {
    expect(formsFor([paid("CHEGG ORDER"), paid("UNIV OF WASHINGTON", "2025-09-08")])).toEqual([]);
  });
});

describe("who sends each form, as pages say it", () => {
  it("leaves out the word for wages", () => {
    expect(formPayer("Campus Bookstore Student Wages")).toBe("Campus Bookstore");
    expect(formPayer("City Of Seattle Wages")).toBe("City Of Seattle");
  });

  it("is named without the bank's word for how the money came", () => {
    expect(formPayer("Blue Bottle Coffee Payroll")).toBe("Blue Bottle Coffee");
    expect(formPayer("Stripe Transfer")).toBe("Stripe");
    expect(formPayer("Etsy Inc Deposit")).toBe("Etsy Inc");
    expect(formPayer("Deposit")).toBe("Deposit");
    expect(formPayer("Shopify Payouts")).toBe("Shopify");
    expect(formPayer("ACME CORP DIRECT DEP")).toBe("ACME CORP");
    // Debugger 11-02: a driver's 1099s, "Uber Technologies Payout" and "Lyft Inc Driver Pay".
    expect(formPayer("Uber Technologies Payout")).toBe("Uber Technologies");
    expect(formPayer("Lyft Inc Driver Pay")).toBe("Lyft Inc");
    // A name that is only those words, or has them in the middle, stays as it is.
    expect(formPayer("Payroll")).toBe("Payroll");
    expect(formPayer("Transfer Wise Ltd")).toBe("Transfer Wise Ltd");
  });

  it("leaves the form's payer and key as they were", () => {
    const [form] = expectedForms({
      year: 2026,
      transactions: [
        tx({
          pfcDetailed: "INCOME_CONTRACTOR",
          merchantName: "Stripe Transfer",
          amountCents: -500_000,
        }),
      ],
      accounts: [],
      loans: [],
    });
    expect([form.from, form.key]).toEqual(["Stripe Transfer", "nec:stripe-transfer"]);
  });
});
