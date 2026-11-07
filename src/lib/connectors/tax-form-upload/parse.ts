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

const AMOUNT = /\$?\s*(-?[\d,]+\.\d{2})\b/g;
// Where any box's printed label starts on a line: its number, then a word ("2 Federal", "12a See").
const BOX_START = /(?<=^|\s)\d{1,2}[a-d]?\s+[A-Za-z]/g;

const amountsIn = (line: string) =>
  [...line.matchAll(AMOUNT)].map((m) => ({
    at: m.index + m[0].indexOf(m[1]!),
    cents: Math.round(Number(m[1]!.replace(/,/g, "")) * 100),
  }));
const boxStarts = (line: string) => [...line.matchAll(BOX_START)].map((m) => m.index);

// The amount for the label at `index`: on its own line, between it and the next box's label; else
// on the line under it. Under a row of labels (the IRS grid, "1 Wages … 2 Federal income tax
// withheld", the amounts on the line below), the amount is the one under the label's own column:
// the first box's amount isn't the second's (debugger 11-06: federal withholding read as the
// wages). A label under a bare label (labels stacked, then their amounts) has no amount it can be
// sure of.
function amountAt(text: string, index: number, labelLength: number): number | null {
  const lines = text.split("\n");
  let start = 0;
  let row = 0;
  while (row < lines.length - 1 && start + lines[row]!.length < index) {
    start += lines[row]!.length + 1;
    row += 1;
  }
  const line = lines[row]!;
  const col = index - start;
  const starts = boxStarts(line);
  const next = starts.find((s) => s >= col + labelLength) ?? Infinity;
  const own = amountsIn(line).find((a) => a.at >= col + labelLength && a.at < next);
  if (own) return own.cents;
  if (amountsIn(line).length > 0) return null;
  const below = lines[row + 1] ?? "";
  if (boxStarts(below).length > 0) return null;
  const others = starts.filter((s) => s < col || s >= col + labelLength);
  if (others.length === 0) {
    const above = lines[row - 1] ?? "";
    if (boxStarts(above).length > 0 && amountsIn(above).length === 0) return null;
    return amountsIn(below)[0]?.cents ?? null;
  }
  // Each label's column runs from its start (less a little, for a right-aligned amount) to the
  // next label's.
  const from = starts.filter((s) => s <= col).length > 1 ? col - 2 : 0;
  return amountsIn(below).find((a) => a.at >= from && a.at < next - 2)?.cents ?? null;
}

class TaxFormError extends Error {
  constructor(reason: string) {
    super(`That doesn't look like a W-2 or 1099 Jane can read: ${reason}.`);
    this.name = "TaxFormError";
  }
}

export type ReadForm = { kind: Readable; boxes: DocumentBoxes };

export function parseTaxForm(raw: string): ReadForm {
  if (raw.length > 2_000_000) throw new TaxFormError("too large");
  const text = raw.replace(/\r\n?/g, "\n");
  const kind = KINDS.find(([, test]) => test.test(text))?.[0];
  if (!kind) throw new TaxFormError("no form name in it");
  const boxes: Record<string, number> = {};
  for (const [box, label] of Object.entries(LABELS[kind])) {
    const at = label.exec(text);
    if (!at) continue;
    // The amount on the label's line or the next one, never further.
    const cents = amountAt(text, at.index, at[0].length);
    if (cents !== null) boxes[box] = cents;
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
