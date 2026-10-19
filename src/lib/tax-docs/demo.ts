import { DEMO_PAY_STUB, INCOME_KINDS } from "@/config/tax";
import { scopedFor } from "@/lib/db-scoped";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { DIVIDENDS, QUALIFIED } from "@/planning/tax-income";
import type { DocumentBoxes } from "@/planning/tax-document-check";
import type { ExpectedForm } from "@/planning/tax-documents";
import type { FetchedForm, TaxDocumentPartner } from "./types";

// The document partner's stand-in (spec step 166), for the demo bank: it plays each payer.
// The payroll stand-in's W-2 adds up the sample pay stub (src/config/tax.ts DEMO_PAY_STUB)
// for every paycheck it paid; the bank's 1099-INT, the payers' 1099s and the brokerage's
// consolidated 1099 add up what each paid. It collects nothing from anywhere real.

const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lt: new Date(Date.UTC(year + 1, 0, 1)),
});

// The year's W-2 for take-home pay of netCents, from the sample stub.
export function demoW2(netCents: number): DocumentBoxes {
  const by = netCents / DEMO_PAY_STUB.netCents;
  const s = (cents: number) => Math.round(cents * by);
  const gross = s(DEMO_PAY_STUB.grossCents);
  const retirement = s(DEMO_PAY_STUB.retirementCents);
  const pretax = s(DEMO_PAY_STUB.otherPretaxCents);
  const federal = s(DEMO_PAY_STUB.federalWithheldCents);
  const socialSecurity = s(DEMO_PAY_STUB.socialSecurityCents);
  const medicare = s(DEMO_PAY_STUB.medicareCents);
  const disability = s(DEMO_PAY_STUB.stateDisabilityCents);
  const wages = gross - retirement - pretax;
  // The deposits are the take-home: whatever rounding left goes to state tax withheld.
  const state = wages - federal - socialSecurity - medicare - disability - netCents;
  return {
    wages,
    federalWithheld: federal,
    socialSecurityWages: gross - pretax,
    socialSecurityTax: socialSecurity,
    medicareWages: gross - pretax,
    medicareTax: medicare,
    retirement,
    otherWithheld: disability,
    stateWages: wages,
    stateWithheld: state,
  };
}

export const demoDocumentPartner: TaxDocumentPartner = {
  name: "demo",
  async fetchForms(userId, year, expected, { client, today }) {
    const db = scopedFor(userId, client);
    const ready = expected.filter((f) => f.by <= today && !f.mayNotSend);
    if (ready.length === 0) return [];
    const [transactions, accounts, cash, investments, loans] = await Promise.all([
      db.transactions.findMany({
        where: { pending: false, amountCents: { lt: 0 }, date: yearRange(year) },
        select: {
          amountCents: true,
          pfcDetailed: true,
          description: true,
          merchantName: true,
          account: { select: { name: true } },
        },
      }),
      db.accounts.findMany({ select: { id: true, name: true } }),
      db.investmentTransactions.findMany({
        where: { type: "cash", date: yearRange(year), amountCents: { lt: 0 } },
        select: { amountCents: true, subtype: true, accountId: true },
      }),
      ready.some((f) => f.formKey === "brokerage")
        ? loadInvestmentTaxes(userId, year, { client, now: new Date(`${today}T12:00:00Z`) })
        : null,
      // The lender's own record of the interest (the bank reports it as of the last sync).
      db.liabilities.findMany({
        select: { ytdInterestPaidCents: true, account: { select: { name: true } } },
      }),
    ]);
    const paid =
      (categories: readonly string[], from: (t: (typeof transactions)[0]) => string) =>
      (form: ExpectedForm) =>
        transactions
          .filter(
            (t) =>
              t.pfcDetailed !== null && categories.includes(t.pfcDetailed) && from(t) === form.from,
          )
          .reduce((s, t) => s - t.amountCents, 0);
    const payer = (t: (typeof transactions)[0]) => (t.merchantName ?? t.description).trim();

    const out: FetchedForm[] = [];
    for (const form of ready) {
      const boxes = ((): DocumentBoxes | null => {
        switch (form.formKey) {
          case "w2": {
            const net = paid(INCOME_KINDS.w2.categories, payer)(form);
            return net > 0 ? demoW2(net) : null;
          }
          case "nec":
            return { compensation: paid(INCOME_KINDS.self_employed.categories, payer)(form) };
          case "r":
            return { gross: paid(INCOME_KINDS.retirement.categories, payer)(form) };
          case "g":
            return { amount: paid(INCOME_KINDS.unemployment.categories, payer)(form) };
          case "int":
            return { interest: paid(["INCOME_INTEREST_EARNED"], (t) => t.account.name)(form) };
          case "brokerage": {
            const ids = new Set(accounts.filter((a) => a.name === form.from).map((a) => a.id));
            const mine = cash.filter((c) => ids.has(c.accountId));
            const sum = (set: Set<string>) =>
              mine.filter((c) => set.has(c.subtype)).reduce((s, c) => s - c.amountCents, 0);
            const sales = (investments?.realised ?? []).filter((r) => ids.has(r.accountId));
            const total = (pick: (r: (typeof sales)[0]) => number) =>
              sales.reduce((s, r) => s + pick(r), 0);
            return {
              dividends: sum(DIVIDENDS),
              qualifiedDividends: sum(QUALIFIED),
              proceeds: total((r) => r.proceedsCents),
              costBasis: total((r) => r.costCents),
              shortTermGain: total((r) => r.shortTermCents),
              longTermGain: total((r) => r.longTermCents),
              washDisallowed: total((r) => r.washDisallowedCents),
            };
          }
          case "mortgage":
          case "student": {
            const interest =
              form.amountCents ??
              loans.find((l) => l.account.name === form.from)?.ytdInterestPaidCents ??
              null;
            return interest !== null && interest > 0 ? { interest } : null;
          }
        }
      })();
      if (boxes) out.push({ key: form.key, boxes });
    }
    return out;
  },
};
