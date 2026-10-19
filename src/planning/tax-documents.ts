import {
  INCOME_KINDS,
  INT_THRESHOLD_CENTS,
  MORTGAGE_INTEREST_THRESHOLD_CENTS,
  STUDENT_INTEREST_THRESHOLD_CENTS,
  TAXABLE_INVESTMENT_SUBTYPES,
  TAX_FORMS,
  necThreshold,
  type IncomeKind,
  type TaxFormKey,
} from "@/config/tax";

// The tax forms to expect for a year (spec step 119), from the payers Jane sees in the
// person's income and their loans. Pure. A form is expected from each payer; a freelance
// payer below the reporting threshold may not send one, so it's listed as such (the
// income still counts).

export type FormTransaction = {
  date: string;
  amountCents: number;
  pfcDetailed: string | null;
  description: string;
  merchantName: string | null;
  accountName: string;
};
export type FormAccount = { name: string; type: string; subtype: string | null };
export type FormLoan = { name: string; kind: string; ytdInterestPaidCents: number | null };

export type ExpectedForm = {
  // Stable for the year: "<form>:<payer>", for "I have it".
  key: string;
  formKey: TaxFormKey;
  form: string;
  from: string;
  what: string;
  // YYYY-MM-DD, the usual date it must be sent by.
  by: string;
  // What Jane saw for it this year, when she saw an amount.
  amountCents: number | null;
  // Below the reporting threshold: the payer may not send one.
  mayNotSend: boolean;
};

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const PAYER_FORMS: readonly [IncomeKind, TaxFormKey][] = [
  ["w2", "w2"],
  ["self_employed", "nec"],
  ["retirement", "r"],
  ["unemployment", "g"],
];

export function expectedForms(input: {
  year: number;
  transactions: FormTransaction[];
  accounts: FormAccount[];
  // Loans with this year's interest; for a past year, with null (banks only report the
  // current year's).
  loans: FormLoan[];
}): ExpectedForm[] {
  const inYear = input.transactions.filter(
    (t) => Number(t.date.slice(0, 4)) === input.year && t.amountCents < 0,
  );
  const make = (
    formKey: TaxFormKey,
    from: string,
    amountCents: number | null,
    mayNotSend = false,
  ): ExpectedForm => ({
    key: `${formKey}:${slug(from)}`,
    formKey,
    form: TAX_FORMS[formKey].form,
    from,
    what: TAX_FORMS[formKey].what,
    by: `${input.year + 1}-${TAX_FORMS[formKey].by}`,
    amountCents,
    mayNotSend,
  });

  const forms: ExpectedForm[] = [];
  const totals = (kindCategories: readonly string[], payerOf: (t: FormTransaction) => string) => {
    const byPayer = new Map<string, number>();
    for (const t of inYear) {
      if (t.pfcDetailed === null || !kindCategories.includes(t.pfcDetailed)) continue;
      byPayer.set(payerOf(t), (byPayer.get(payerOf(t)) ?? 0) - t.amountCents);
    }
    return [...byPayer.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const payer = (t: FormTransaction) => (t.merchantName ?? t.description).trim();

  for (const [kind, formKey] of PAYER_FORMS) {
    for (const [from, cents] of totals(INCOME_KINDS[kind].categories, payer)) {
      const mayNotSend = formKey === "nec" && cents < necThreshold(input.year);
      forms.push(make(formKey, from, cents, mayNotSend));
    }
  }
  // Interest: one 1099-INT per bank account that paid at least the threshold.
  for (const [from, cents] of totals(["INCOME_INTEREST_EARNED"], (t) => t.accountName)) {
    if (cents >= INT_THRESHOLD_CENTS) forms.push(make("int", from, cents));
  }
  // A taxable investment account sends one consolidated form.
  for (const a of input.accounts) {
    if (a.type === "investment" && TAXABLE_INVESTMENT_SUBTYPES.includes(a.subtype ?? "")) {
      forms.push(make("brokerage", a.name, null));
    }
  }
  for (const loan of input.loans) {
    // A past year's interest isn't reported any more (null): the lender still sends the form.
    if (
      loan.ytdInterestPaidCents === null &&
      (loan.kind === "mortgage" || loan.kind === "student")
    ) {
      forms.push(make(loan.kind, loan.name, null));
      continue;
    }
    const cents = loan.ytdInterestPaidCents ?? 0;
    if (loan.kind === "mortgage" && cents >= MORTGAGE_INTEREST_THRESHOLD_CENTS) {
      forms.push(make("mortgage", loan.name, cents));
    }
    if (loan.kind === "student" && cents >= STUDENT_INTEREST_THRESHOLD_CENTS) {
      forms.push(make("student", loan.name, cents));
    }
  }
  return forms;
}
