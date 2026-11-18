import type { TaxFormKey } from "@/config/tax";
import type { DocumentBoxes } from "@/planning/tax-document-check";
import type { AkoyaStatement, AkoyaTaxForm } from "./api";

// Akoya's tax forms in Jane's shape: the form Jane expects (TAX_FORMS) and its boxes by Jane's own
// names (DOCUMENT_BOXES), in cents, the way the tax-form upload and the demo partner give them, so
// the documents check compares them with the accounts unchanged. Box amounts only: Akoya's forms
// also carry names, addresses, TINs and account numbers, and none of that comes out. Pure.
//
// The forms Jane reads from Akoya are the ones whose fields were read in Akoya's reference:
// 1099-INT, 1099-DIV with 1099-B (Jane's consolidated "brokerage" form), 1099-R, 1099-G, 1099-NEC,
// 1098 and 1098-E. A W-2's fields weren't readable there, and W-2s come from payroll, not banks: left
// out rather than guessed. Akoya has no 1098-T, SSA-1099 or 1099-DA.

export type ReadForm = {
  formKey: TaxFormKey;
  // Akoya's id for the account the form is for, to find which of Jane's accounts it is.
  accountId: string | null;
  boxes: DocumentBoxes;
};

const cents = (dollars: number | null | undefined) =>
  typeof dollars === "number" && Number.isFinite(dollars) ? Math.round(dollars * 100) : null;

// Boxes with an amount; a box Akoya leaves empty is left out, never read as zero.
function boxesOf(entries: [string, number | null | undefined][]): DocumentBoxes {
  const out: Record<string, number> = {};
  for (const [name, dollars] of entries) {
    const value = cents(dollars);
    if (value !== null) out[name] = value;
  }
  return out;
}

// 1099-B's sales, summed the way Jane's brokerage form keeps them. A gain is the sale less its
// basis plus any wash sale loss disallowed (the IRS's 1099-B arithmetic); its term is Akoya's
// longOrShort, and a sale with neither term counts toward proceeds and basis only.
function sales(form: AkoyaTaxForm): DocumentBoxes {
  const list = form.tax1099B?.securityDetails ?? [];
  if (list.length === 0) return {};
  let proceeds = 0;
  let costBasis = 0;
  let wash = 0;
  let short = 0;
  let long = 0;
  for (const sale of list) {
    const price = cents(sale.salesPrice) ?? 0;
    const basis = cents(sale.costBasis) ?? 0;
    const disallowed = cents(sale.washSaleLossDisallowed) ?? 0;
    proceeds += price;
    costBasis += basis;
    wash += disallowed;
    const term = (sale.longOrShort ?? "").toUpperCase();
    if (term.startsWith("SHORT")) short += price - basis + disallowed;
    if (term.startsWith("LONG")) long += price - basis + disallowed;
  }
  return {
    proceeds,
    costBasis,
    shortTermGain: short,
    longTermGain: long,
    washDisallowed: wash,
  };
}

function readOne(form: AkoyaTaxForm): { formKey: TaxFormKey; boxes: DocumentBoxes } | null {
  switch (form.taxFormType) {
    case "Tax1099Int":
      return {
        formKey: "int",
        boxes: boxesOf([
          ["interest", form.tax1099Int?.interestIncome],
          ["federalWithheld", form.tax1099Int?.federalTaxWithheld],
        ]),
      };
    case "Tax1099Div":
      return {
        formKey: "brokerage",
        boxes: boxesOf([
          ["dividends", form.tax1099Div?.ordinaryDividends],
          ["qualifiedDividends", form.tax1099Div?.qualifiedDividends],
        ]),
      };
    case "Tax1099B":
      return { formKey: "brokerage", boxes: sales(form) };
    case "Tax1099R":
      return {
        formKey: "r",
        boxes: boxesOf([
          ["gross", form.tax1099R?.grossDistribution],
          ["taxable", form.tax1099R?.taxableAmount],
          ["federalWithheld", form.tax1099R?.federalTaxWithheld],
        ]),
      };
    case "Tax1099G":
      return {
        formKey: "g",
        boxes: boxesOf([
          ["amount", form.tax1099G?.unemploymentCompensation],
          ["federalWithheld", form.tax1099G?.federalTaxWithheld],
        ]),
      };
    case "Tax1099Nec":
      return {
        formKey: "nec",
        boxes: boxesOf([
          ["compensation", form.tax1099Nec?.nonEmployeeCompensation],
          ["federalWithheld", form.tax1099Nec?.federalTaxWithheld],
        ]),
      };
    case "Tax1098":
      return {
        formKey: "mortgage",
        boxes: boxesOf([
          ["interest", form.tax1098?.mortgageInterest],
          ["points", form.tax1098?.pointsPaid],
        ]),
      };
    case "Tax1098E":
      return {
        formKey: "student",
        boxes: boxesOf([["interest", form.tax1098E?.studentLoanInterest]]),
      };
    default:
      return null;
  }
}

// The year's forms, one per kind and account. A brokerage's 1099-DIV and 1099-B on one account
// are one consolidated form; a corrected form replaces the one before it.
export function formsFromStatements(statements: AkoyaStatement[], taxYear: number): ReadForm[] {
  const out = new Map<string, ReadForm>();
  for (const statement of statements) {
    for (const form of statement.forms) {
      const year = form.taxYear ?? statement.taxYear;
      if (year !== taxYear) continue;
      const read = readOne(form);
      if (!read || Object.keys(read.boxes).length === 0) continue;
      const accountId = form.accountId ?? null;
      const key = `${read.formKey}|${accountId ?? statement.taxStatementId ?? ""}`;
      const before = out.get(key);
      out.set(key, {
        formKey: read.formKey,
        accountId,
        // Consolidated: DIV and B add their own boxes; a corrected form's boxes win.
        boxes: { ...before?.boxes, ...read.boxes },
      });
    }
  }
  return [...out.values()];
}
