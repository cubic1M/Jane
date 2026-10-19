import { TAX_DOCUMENTS, type TaxFormKey } from "@/config/tax";

// Checking a collected tax form against the accounts (spec step 166). Pure. Each form has
// one amount that should match what Jane saw: a W-2's take-home pay (wages less what was
// withheld) against the paychecks, a 1099's payments, interest or dividends against the
// money in, a 1098's interest against what the lender reports. A form that disagrees is
// flagged and never used until the person says it's right; with nothing to compare, it's
// "unchecked" and said so.

// Box amounts in cents, by name.
export type DocumentBoxes = Readonly<Record<string, number>>;

// The boxes each form carries, with how they're labelled.
export const DOCUMENT_BOXES: Readonly<Record<TaxFormKey, Readonly<Record<string, string>>>> = {
  w2: {
    wages: "Box 1, wages",
    federalWithheld: "Box 2, federal tax withheld",
    socialSecurityWages: "Box 3, Social Security wages",
    socialSecurityTax: "Box 4, Social Security tax",
    medicareWages: "Box 5, Medicare wages",
    medicareTax: "Box 6, Medicare tax",
    retirement: "Box 12 D, 401(k)",
    otherWithheld: "Box 14, state disability",
    stateWages: "Box 16, state wages",
    stateWithheld: "Box 17, state tax withheld",
  },
  nec: { compensation: "Box 1, payments", federalWithheld: "Box 4, federal tax withheld" },
  int: { interest: "Box 1, interest", federalWithheld: "Box 4, federal tax withheld" },
  brokerage: {
    dividends: "1099-DIV box 1a, dividends",
    qualifiedDividends: "1099-DIV box 1b, qualified dividends",
    proceeds: "1099-B, proceeds",
    costBasis: "1099-B, cost basis",
    shortTermGain: "1099-B, short-term gain or loss",
    longTermGain: "1099-B, long-term gain or loss",
    washDisallowed: "1099-B, wash sale loss disallowed",
  },
  r: { gross: "Box 1, gross payout", taxable: "Box 2a, taxable", federalWithheld: "Box 4" },
  g: { amount: "Box 1, unemployment", federalWithheld: "Box 4, federal tax withheld" },
  mortgage: { interest: "Box 1, mortgage interest", points: "Box 6, points" },
  student: { interest: "Box 1, student loan interest" },
};

// What the form's amount is compared with, said plainly.
export const COMPARED: Readonly<Record<TaxFormKey, string>> = {
  w2: "take-home pay",
  nec: "payments",
  int: "interest",
  brokerage: "dividends",
  r: "payouts after tax",
  g: "payments after tax",
  mortgage: "mortgage interest",
  student: "student loan interest",
};

const box = (boxes: DocumentBoxes, name: string) => boxes[name] ?? 0;

// The form's amount that should match the accounts.
export function formAmount(formKey: TaxFormKey, boxes: DocumentBoxes): number {
  switch (formKey) {
    case "w2":
      return (
        box(boxes, "wages") -
        box(boxes, "federalWithheld") -
        box(boxes, "socialSecurityTax") -
        box(boxes, "medicareTax") -
        box(boxes, "stateWithheld") -
        box(boxes, "otherWithheld")
      );
    case "nec":
      return box(boxes, "compensation");
    case "int":
      return box(boxes, "interest");
    case "brokerage":
      return box(boxes, "dividends");
    case "r":
      return box(boxes, "gross") - box(boxes, "federalWithheld");
    case "g":
      return box(boxes, "amount") - box(boxes, "federalWithheld");
    case "mortgage":
    case "student":
      return box(boxes, "interest");
  }
}

export type DocumentCheck = {
  status: "matches" | "differs" | "unchecked";
  formCents: number;
  seenCents: number | null;
  // Form less accounts.
  diffCents: number;
};

export const withinTolerance = (formCents: number, seenCents: number) =>
  Math.abs(formCents - seenCents) <=
  Math.max(TAX_DOCUMENTS.matchCents, Math.round(Math.abs(seenCents) * TAX_DOCUMENTS.matchShare));

export function checkDocument(
  formKey: TaxFormKey,
  boxes: DocumentBoxes,
  seenCents: number | null,
): DocumentCheck {
  const formCents = formAmount(formKey, boxes);
  if (seenCents === null) return { status: "unchecked", formCents, seenCents, diffCents: 0 };
  return {
    status: withinTolerance(formCents, seenCents) ? "matches" : "differs",
    formCents,
    seenCents,
    diffCents: formCents - seenCents,
  };
}

// Whether a form's figures may be used (in the return, ticked off): it matches, there's
// nothing to check it against (said so), or the person said it's right. A flagged form
// never is.
export const usable = (check: DocumentCheck, personSaidRight: boolean) =>
  check.status !== "differs" || personSaidRight;
