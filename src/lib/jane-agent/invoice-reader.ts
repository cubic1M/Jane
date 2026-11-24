import { INVOICE_MAX_LINES } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { ChargeExplanation } from "./charge-explain";

// An invoice the person pastes (founder 11-24: "why did I pay $100 to Vercel?" needs what the bank
// can't show): its line items and total read out of the text, and, set against the charge, the lines
// that explain the difference from the usual. Rules, no Claude: it runs on the backup too, in memory,
// and nothing about it is kept. The words on an invoice are the company's, shown as written and never
// as Jane's own. Pure.
//
// What it reads: text with one line item to a line, ending in its amount ("Pro plan, 1 seat  $20.00",
// "Bandwidth, 150 GB  $60.00", "Credit  -$5.00" or "($5.00)"), a total ("Total", "Amount due", "Amount
// paid") and an optional subtotal. What it can't: a PDF or a picture (copy its text out and paste
// that), a layout that puts the amount on the line below its words, and amounts without cents.

export type InvoiceLine = { description: string; cents: number };

export type Invoice = {
  lines: InvoiceLine[];
  totalCents: number | null;
  // What the lines add up to (credits taken off).
  linesCents: number;
};

// An amount with its cents, a dollar sign or not, a minus or brackets for a credit. Not a unit price
// ("$0.15/GB", "$0.15 per GB").
const AMOUNT = /(-|−)?(\()?\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(\))?(?!\s*(?:\/|per\b))/g;
const TOTAL =
  /^(?:invoice\s+)?(?:grand\s+)?(?:total(?:\s+(?:due|amount|paid))?|amount\s+(?:due|paid)|balance\s+due|paid)\b/i;
const SUBTOTAL = /^subtotal\b/i;
// The first price of any kind on a line: an amount, or a unit price that has more cents or "/GB".
const FIRST_PRICE = /[-−(]?\$\s?\d|[-−(]?\b\d[\d,]*\.\d{2,}/;

const toCents = (digits: string) => Math.round(Number(digits.replace(/,/g, "")) * 100);
const tidy = (text: string) =>
  text
    .replace(/^[\s|•·*\-–—>]+/, "")
    .replace(/[\s|:·.\-–—]+$/, "")
    .replace(/\s+[x×]$/i, "")
    .replace(/\s+/g, " ")
    .trim();

export function readInvoice(text: string): Invoice | null {
  const lines: InvoiceLine[] = [];
  let totalCents: number | null = null;
  for (const raw of text.split(/\r?\n/).slice(0, INVOICE_MAX_LINES)) {
    const found = [...raw.matchAll(AMOUNT)];
    const last = found[found.length - 1];
    if (!last) continue;
    // Its words are what comes before the first price on the line, a unit price included, less the
    // quantity column.
    const firstPrice = FIRST_PRICE.exec(raw)?.index ?? found[0]!.index;
    const description = tidy(raw.slice(0, firstPrice)).replace(/(?:\s+\d+)+$/, "");
    if (!description) continue;
    const credit = Boolean(last[1] || (last[2] && last[4]));
    const cents = (credit ? -1 : 1) * toCents(last[3]!);
    if (SUBTOTAL.test(description)) continue;
    if (TOTAL.test(description)) {
      totalCents ??= Math.abs(cents);
      continue;
    }
    lines.push({ description, cents });
  }
  if (lines.length === 0) return null;
  return { lines, totalCents, linesCents: lines.reduce((sum, l) => sum + l.cents, 0) };
}

export type InvoiceReading = {
  invoice: Invoice;
  // The charge it was set against, if any, and whether the invoice's total is that charge's amount.
  against: { chargeCents: number; totalMatches: boolean } | null;
  // When the total is the charge and it was more than usual: the line that is the usual, and the
  // lines the extra is made of (a single line that is the whole extra, or all the others).
  usualLine: InvoiceLine | null;
  explaining: InvoiceLine[];
  extraCents: number | null;
};

export function readAgainst(invoice: Invoice, charge: ChargeExplanation | null): InvoiceReading {
  const plain: InvoiceReading = {
    invoice,
    against: null,
    usualLine: null,
    explaining: [],
    extraCents: null,
  };
  if (!charge) return plain;
  const against = {
    chargeCents: charge.charge.cents,
    totalMatches: invoice.totalCents === charge.charge.cents,
  };
  const extra = charge.differenceCents;
  if (!against.totalMatches || !charge.usual || extra === null || extra <= 0) {
    return { ...plain, against };
  }
  const positive = invoice.lines.filter((l) => l.cents > 0);
  const usualLine = charge.usual.exact
    ? (positive.find((l) => l.cents === charge.usual!.cents) ?? null)
    : null;
  const whole = positive.find((l) => l.cents === extra);
  if (whole) return { ...plain, against, usualLine, explaining: [whole], extraCents: extra };
  if (usualLine) {
    const rest = invoice.lines.filter((l) => l !== usualLine);
    return { ...plain, against, usualLine, explaining: rest, extraCents: extra };
  }
  return { ...plain, against, extraCents: extra };
}

const money = formatCents;
const priced = (l: InvoiceLine) =>
  `${l.description} (${l.cents < 0 ? "-" : ""}${money(Math.abs(l.cents))})`;

// What was read, in plain words: the invoice's own lines and total, and what the lines explain.
export function readingWords(r: InvoiceReading): string[] {
  const { invoice } = r;
  const out = [
    `The invoice lists ${invoice.lines.length === 1 ? "1 line" : `${invoice.lines.length} lines`}:`,
    ...invoice.lines.map((l) => `- ${priced(l)}`),
  ];
  out.push(
    invoice.totalCents === null
      ? `I didn't find a total on it; the lines come to ${money(invoice.linesCents)}.`
      : invoice.linesCents === invoice.totalCents
        ? `Together they come to ${money(invoice.totalCents)}, its total.`
        : `Its total is ${money(invoice.totalCents)}, but the lines I could read come to ${money(invoice.linesCents)}, so I may have missed one.`,
  );
  if (!r.against) return out;
  if (!r.against.totalMatches) {
    out.push(
      `That isn't the ${money(r.against.chargeCents)} you were charged, so this may be a different invoice, or only part of one: I won't say which line explains the charge.`,
    );
    return out;
  }
  if (r.extraCents === null) return out;
  const extra = money(r.extraCents);
  if (r.usualLine) out.push(`The ${priced(r.usualLine)} line matches what you usually pay.`);
  if (r.explaining.length === 1) {
    out.push(`The ${priced(r.explaining[0]!)} line accounts for the extra ${extra}.`);
  } else if (r.explaining.length > 1) {
    const rest = r.explaining.reduce((sum, l) => sum + l.cents, 0);
    out.push(
      rest === r.extraCents
        ? `The other lines (${r.explaining.map(priced).join("; ")}) make up the extra ${extra}.`
        : `The other lines (${r.explaining.map(priced).join("; ")}) come to ${money(rest)}, not the extra ${extra}: I may have missed a line.`,
    );
  } else {
    out.push(
      `None of its lines is your usual or the extra ${extra}, so I can't say from it which one explains the charge.`,
    );
  }
  return out;
}

export const NO_INVOICE_LINES =
  "I couldn't read any line items from that. I read text with one line item to a line, each ending in its amount with cents, like \"Pro plan  $20.00\". A PDF or a picture can't be read here: copy the invoice's text out of it and paste that.";
