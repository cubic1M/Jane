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

const AMOUNT = /\$?\s*(-?[\d,]+\.\d{2})\b/;

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
    const cents = boxAmount(text, at.index, at.index + at[0].length);
    if (cents !== null) boxes[box] = cents;
  }
  if (Object.keys(boxes).length === 0) throw new TaxFormError("no boxes found");
  return { kind, boxes };
}

// Where a box's label starts: "2 Federal income tax withheld", "16 State wages", "12a See
// instructions". The amount before it, if any, belongs to the box before.
const BOX_LABEL = /(?<![\w$.,])\d{1,2}[a-z]?\s+[a-z]{3,}/i;

const upToLabel = (line: string) => {
  const next = line.search(BOX_LABEL);
  return next === -1 ? line : line.slice(0, next);
};

// A box's amount: on the label's line, before the next box's label, or, when the label stands
// alone on its line, on the next line before any label there; never further. A blank box has no
// amount of its own, and the next one on the page is another box's, so it's left out, never
// borrowed (a W-2 with nothing withheld read as the Social Security wages under it). Labels side
// by side over a row of amounts can't be told apart, so those are left out too.
function boxAmount(text: string, labelStart: number, labelEnd: number): number | null {
  const [rest = "", next = ""] = text.slice(labelEnd).split(/\r?\n/, 2);
  const before = text.slice(text.lastIndexOf("\n", labelStart) + 1, labelStart);
  const aloneOnLine = !BOX_LABEL.test(before) && !BOX_LABEL.test(rest);
  const amount =
    AMOUNT.exec(upToLabel(rest)) ?? (aloneOnLine ? AMOUNT.exec(upToLabel(next)) : null);
  return amount ? Math.round(Number(amount[1]!.replace(/,/g, "")) * 100) : null;
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
