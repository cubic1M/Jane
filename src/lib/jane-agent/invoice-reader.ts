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
// that), a layout that puts the amount on the line below its words, and amounts without cents. A
// quantity column is taken off a line's words only where the layout marks it (a column gap, a pipe,
// "x 3"): "Office 365" and "Plan 2" keep their numbers.

export type InvoiceLine = { description: string; cents: number };

export type Invoice = {
  lines: InvoiceLine[];
  totalCents: number | null;
  // Every total the invoice states (a paid invoice has a total and an amount due of nothing).
  chargedCents: number[];
  // What the lines add up to (credits taken off).
  linesCents: number;
};

// An amount with its cents, a dollar sign or not, a minus (hyphen, minus sign or en dash) or brackets
// for a credit. Not a unit price ("$0.15/GB", "$0.15 per GB"), and never part of a longer number
// ("$0.015/GB" isn't "$0.01").
const AMOUNT =
  /(?<![\d.,])(-|−|–)?(\()?\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?!\d)(?!\s*\)?\s*(?:\/|per\b))(\s*\))?/gi;
// The first price of any kind on a line: an amount, or a unit price that has more cents or "/GB".
const FIRST_PRICE = /[-−(]?\$\s?\d|[-−(]?\b\d[\d,]*\.\d{2,}/;

// What a line's words are, however it is cased or punctuated: "Pre-tax Total:" is "pre tax total".
const wordsOf = (description: string) =>
  description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// The lines that sum up the others, read from their whole words, in any position and case:
//  - a subtotal ("Subtotal", "Items sub-total", "Pre-tax subtotal");
//  - a total before tax ("Total excluding tax", "Pre-tax total", "Net total", "Amount before VAT"; "before"
//    alone isn't it: "Balance due before Dec 1" is the total charged):
//    a sum of the lines, never the one charged;
//  - the total charged (the last of the strong labels, else the last of the others):
//    "Total", "Grand total", "Order total", "Total due", "Total (USD)",
//    "Total incl. tax", "Amount due", "Balance due on Dec 1", "Amount paid", "Paid". Only these
//    whole forms: "Total Protection" and "Total Wine" are things sold.
const SUBTOTAL = /\bsub ?total\b/;
// One list of the words of a sum, so "net" beside any of them is read the same either way round.
const SUM_WORD = "(?:total|amount|balance|sum|price)";
const SUMS = new RegExp(`\\b${SUM_WORD}\\b`);
const BEFORE_TAX = new RegExp(
  `\\b(?:(?:excl|excluding|before|without|ex)\\b(?:\\s+[a-z]+){0,5}?\\s+(?:tax|taxes|vat|gst)` +
    `|pre ?(?:tax|vat|gst)|net\\s+${SUM_WORD}|${SUM_WORD}\\s+net)\\b`,
);
// Among the totals charged, these labels say the most: the amount to pay, over a plain "Total".
const STRONG_TOTAL =
  /^(?:grand|final)\s+total\b|^(?:total\s+)?(?:amount|balance)\s+due\b|\btotal\s+(?:due|charged|payable)\b/;
const CURRENCY = "(?:usd|eur|gbp|cad|aud)";
const TOTAL_CHARGED = new RegExp(
  `^(?:(?:(?:invoice|grand|final|order)\\s+)?total(?:\\s+(?:due|paid|payable|charged|owed|amount|price|${CURRENCY}))*` +
    `|(?:total\\s+)?(?:amount|balance)\\s+(?:due|paid|payable|owed)(?:\\s+${CURRENCY})?` +
    `|paid)` +
    `(?:\\s+incl(?:uding)?\\s+(?:tax|vat|gst))?(?:\\s+(?:on|by|for|before|until)\\s+.+)?$`,
);
// A line that takes money off ("Discount", "Promo code", "Credit applied"; not "Credit card fee").
const TAKES_OFF =
  /\b(?:discount|coupon|promo|promotion|promotional|rebate|refund|credit(?! card))\b/;

const toCents = (digits: string) => Math.round(Number(digits.replace(/,/g, "")) * 100);

// A line's words: what comes before its first price, without the quantity column and the dots that
// lead to the price. A number that is part of the name stays ("Office 365", "Plan 2"): a quantity is
// taken off only where the layout marks it, by a column gap (a tab, two spaces, a pipe) or "x 3".
const QUANTITY = [/\s+[x×]\s*\d+(?:\.\d+)?$/i, /(?:\t|\s{2,}|\s*\|\s*)\d+(?:\.\d+)?$/];
function descriptionOf(beforePrice: string): string {
  let text = beforePrice
    .replace(/\s*\.{2,}\s*$/, "")
    .replace(/[\s|:·]+$/, "")
    .replace(/\s+[x×]$/i, "");
  for (const quantity of QUANTITY) text = text.replace(quantity, "");
  return text
    .replace(/^[\s|•·*\-–—>]+/, "")
    .replace(/[\s|:·\-–—]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function readInvoice(text: string): Invoice | null {
  const lines: InvoiceLine[] = [];
  const charged: { cents: number; strong: boolean }[] = [];
  for (const raw of text.split(/\r?\n/).slice(0, INVOICE_MAX_LINES)) {
    const found = [...raw.matchAll(AMOUNT)];
    const last = found[found.length - 1];
    if (!last) continue;
    const firstPrice = FIRST_PRICE.exec(raw)?.index ?? found[0]!.index;
    const description = descriptionOf(raw.slice(0, firstPrice));
    if (!description) continue;
    // A minus or brackets, or "CR" or a dash after it.
    const after = raw.slice(last.index + last[0].length);
    const credit = Boolean(last[1] || (last[2] && last[4]) || /^\s*(?:cr\b|-\s*$)/i.test(after));
    const cents = (credit ? -1 : 1) * toCents(last[3]!);
    const words = wordsOf(description);
    if (SUBTOTAL.test(words) || (SUMS.test(words) && BEFORE_TAX.test(words))) continue;
    if (TOTAL_CHARGED.test(words)) {
      charged.push({ cents: Math.abs(cents), strong: STRONG_TOTAL.test(words) });
      continue;
    }
    lines.push({ description, cents });
  }
  if (lines.length === 0) return null;
  const totalCents = chosenTotal(charged);
  const signed = signedToTotal(lines, totalCents);
  return {
    lines: signed,
    totalCents,
    chargedCents: charged.map((t) => t.cents),
    linesCents: sumOf(signed),
  };
}

// The total charged, from every line that says one: a strong label ("Grand total", "Amount due",
// "Total charged") over a plain "Total", and the last of those, since an invoice ends with what is
// to be paid. A nothing-to-pay line ("Amount due $0.00" on a paid invoice) only when nothing else is.
function chosenTotal(charged: { cents: number; strong: boolean }[]): number | null {
  const owing = charged.filter((t) => t.cents > 0);
  const pool = owing.length > 0 ? owing : charged;
  const strong = pool.filter((t) => t.strong);
  const from = strong.length > 0 ? strong : pool;
  return from.length > 0 ? from[from.length - 1]!.cents : null;
}

const sumOf = (lines: InvoiceLine[]) => lines.reduce((total, l) => total + l.cents, 0);

// A "Discount $5.00" with no minus takes money off all the same: read it so, but only when that makes
// the lines add up to the total the invoice states.
function signedToTotal(lines: InvoiceLine[], totalCents: number | null): InvoiceLine[] {
  if (totalCents === null || sumOf(lines) === totalCents) return lines;
  const flipped = lines.map((l) =>
    l.cents > 0 && TAKES_OFF.test(wordsOf(l.description)) ? { ...l, cents: -l.cents } : l,
  );
  return sumOf(flipped) === totalCents ? flipped : lines;
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
  // With the usual line found but the other lines not adding up to the extra: what they do come to.
  otherLinesCents: number | null;
};

export function readAgainst(invoice: Invoice, charge: ChargeExplanation | null): InvoiceReading {
  const plain: InvoiceReading = {
    invoice,
    against: null,
    usualLine: null,
    explaining: [],
    extraCents: null,
    otherLinesCents: null,
  };
  if (!charge) return plain;
  const against = {
    chargeCents: charge.charge.cents,
    // Any total it states: a part-paid invoice has a total and a smaller amount due.
    totalMatches: invoice.chargedCents.includes(charge.charge.cents),
  };
  const extra = charge.differenceCents;
  if (!against.totalMatches || !charge.usual || extra === null || extra <= 0) {
    return { ...plain, against };
  }
  const positive = invoice.lines.filter((l) => l.cents > 0);
  const usualLine = charge.usual.exact
    ? (positive.find((l) => l.cents === charge.usual!.cents) ?? null)
    : null;
  // Never the usual line itself: when the extra is the same amount as the usual (usual $50, now
  // $100), a separate $50 line is the extra, and the plan isn't.
  const whole = positive.find((l) => l !== usualLine && l.cents === extra);
  if (whole) return { ...plain, against, usualLine, explaining: [whole], extraCents: extra };
  if (usualLine) {
    // The other lines are the explanation only when they add up to the extra: a missed line, or a
    // total that isn't the lines, and they'd name the wrong ones.
    const rest = invoice.lines.filter((l) => l !== usualLine);
    const restCents = rest.reduce((sum, l) => sum + l.cents, 0);
    return restCents === extra
      ? { ...plain, against, usualLine, explaining: rest, extraCents: extra }
      : { ...plain, against, usualLine, extraCents: extra, otherLinesCents: restCents };
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
    out.push(
      `The other lines (${r.explaining.map(priced).join("; ")}) make up the extra ${extra}.`,
    );
  } else if (r.otherLinesCents !== null) {
    out.push(
      `The other lines come to ${money(r.otherLinesCents)}, not the extra ${extra}, so I may have missed a line and won't say which one explains the charge.`,
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
