import type { TaxFormKey } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import type { DocumentBoxes } from "@/planning/tax-document-check";
import { consentCovers, usableConnector } from "../consent";
import { taxFormUpload } from "./connector";

// A W-2 or 1099's text layer (connectors roadmap round 16, tax_form_upload): the PDF a person
// downloads from their employer, bank or broker. Each box is found by its printed label, and the
// first amount after it, on its line or the next, is the box's. The form also carries names,
// addresses, SSNs, EINs and account numbers: only box amounts, by Jane's box names
// (DOCUMENT_BOXES), come out, and the file is never stored. Layouts differ by issuer; a box
// whose label isn't found is left out, never guessed.

type Readable = Extract<TaxFormKey, "w2" | "nec" | "int" | "brokerage">;

// Printed labels for each box, as forms and issuers word them.
const LABELS: Record<Readable, Record<string, RegExp>> = {
  w2: {
    wages: /\b1\s+wages,? tips,? other comp(?:ensation)?/i,
    federalWithheld: /\b2\s+federal income tax withheld/i,
    socialSecurityWages: /\b3\s+social security wages/i,
    socialSecurityTax: /\b4\s+social security tax withheld/i,
    medicareWages: /\b5\s+medicare wages and tips/i,
    medicareTax: /\b6\s+medicare tax withheld/i,
    stateWages: /\b16\s+state wages,? tips,? etc/i,
    stateWithheld: /\b17\s+state income tax/i,
  },
  nec: {
    compensation: /\b1\s+nonemployee compensation/i,
    federalWithheld: /\b4\s+federal income tax withheld/i,
  },
  int: {
    interest: /\b1\s+interest income/i,
    federalWithheld: /\b4\s+federal income tax withheld/i,
  },
  brokerage: {
    dividends: /(?:\b1a\s+total ordinary dividends|total ordinary dividends\s*\(1a\))/i,
    qualifiedDividends: /(?:\b1b\s+qualified dividends|qualified dividends\s*\(1b\))/i,
  },
};

// What tells the form apart, in the order they're tried (a consolidated 1099 names DIV first).
const KINDS: [Readable, RegExp][] = [
  ["w2", /\bform\s+w-2\b|wage and tax statement/i],
  ["brokerage", /\b1099-div\b|consolidated form 1099/i],
  ["nec", /\b1099-nec\b|nonemployee compensation/i],
  ["int", /\b1099-int\b/i],
];

// An amount, from the start of its digits: "61,240.00", "48000.00", "-12.00". Each try ends within a
// few characters unless it is an amount, so a long run of digits or spaces is read in one pass
// (an open-ended "[\d,]+" from every position took minutes on a 2 MB line).
const AMOUNT = /(?<![\d.,])(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?!\d)/;

class TaxFormError extends Error {
  constructor(reason: string) {
    super(`That doesn't look like a W-2 or 1099 Jane can read: ${reason}.`);
    this.name = "TaxFormError";
  }
}

export type ReadForm = { kind: Readable; boxes: DocumentBoxes };

export function parseTaxForm(text: string): ReadForm {
  if (text.length > 2_000_000) throw new TaxFormError("too large");
  const kind = KINDS.find(([, test]) => test.test(text))?.[0];
  if (!kind) throw new TaxFormError("no form name in it");
  const boxes: Record<string, number> = {};
  for (const [box, label] of Object.entries(LABELS[kind])) {
    const at = label.exec(text);
    if (!at) continue;
    // The amount on the label's line or the next one, never further.
    const after = text
      .slice(at.index + at[0].length)
      .split(/\r?\n/)
      .slice(0, 2)
      .join(" ");
    const amount = AMOUNT.exec(after);
    if (!amount) continue;
    boxes[box] = Math.round(Number(amount[1]!.replace(/,/g, "")) * 100);
  }
  if (Object.keys(boxes).length === 0) throw new TaxFormError("no boxes found");
  return { kind, boxes };
}

type Options = { client?: PrismaClient };

// Reads one uploaded form for the person, with the connector on for them and their consent. The
// file itself is never kept; matching it to the forms Jane expects is the tax lane's.
export async function readTaxFormUpload(
  userId: string,
  text: string,
  { client = defaultClient }: Options = {},
): Promise<ReadForm> {
  const connector = await usableConnector(userId, taxFormUpload.id, { client });
  if (!(await consentCovers(userId, connector, { client }))) throw new TaxFormError("no consent");
  const form = parseTaxForm(text);
  await logAudit(
    { type: "user", id: userId },
    "tax_form_uploaded",
    { type: "user", id: userId },
    { kind: form.kind, boxes: Object.keys(form.boxes).length },
  );
  await track(userId, "tax_form_uploaded", { kind: form.kind });
  return form;
}
