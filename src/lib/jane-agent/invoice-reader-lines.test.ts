import { describe, expect, it } from "vitest";
import { readInvoice } from "./invoice-reader";

// What each kind of invoice line is, one table of real-looking lines (CodeRabbit's rounds on the
// reader: "Pre-tax total" read as an item, "Office 365" read as "Office"). Each is read beside a
// filler item, so what the line becomes shows: an item, the total, or nothing (a sum of the lines).

type Expected =
  | { is: "item"; description: string; cents: number }
  | { is: "total"; cents: number }
  | { is: "sum" };

const FILLER = { description: "Filler item", cents: 100 };
const read = (line: string) => {
  const invoice = readInvoice(`${line}\nFiller item  $1.00`)!;
  return { lines: invoice.lines, total: invoice.totalCents };
};

const sums = [
  "Subtotal  $90.00",
  "SUBTOTAL: $90.00",
  "Sub-total  $90.00",
  "Sub total  $90.00",
  "Items subtotal  $90.00",
  "Pre-tax subtotal  $90.00",
  "Pre-tax total  $90.00",
  "Pretax total  $90.00",
  "PRE-TAX TOTAL  $90.00",
  "Total excluding tax  $90.00",
  "Total (excl. VAT)  $90.00",
  "Total before tax  $90.00",
  "Total ex tax  $90.00",
  "Total without tax  $90.00",
  "Net total  $90.00",
  "Amount before tax  $90.00",
  "Balance before tax  $90.00",
];

const totals = [
  "Total  $100.00",
  "TOTAL: $100.00",
  "total  $100.00",
  "Grand Total  $100.00",
  "Invoice total  $100.00",
  "Order total  $100.00",
  "Total due  $100.00",
  "Total amount due  $100.00",
  "Total (USD)  $100.00",
  "Total incl. tax  $100.00",
  "Total including VAT  $100.00",
  "Amount due  $100.00",
  "AMOUNT DUE (USD)  $100.00",
  "Balance due on Dec 1  $100.00",
  "Amount paid  $100.00",
  "Total paid  $100.00",
  "Paid  $100.00",
];

const items: [string, Expected][] = [
  // Things sold with "total", "tax", "credit" or "paid" in the name stay items.
  [
    "Total Protection plan  $5.99",
    { is: "item", description: "Total Protection plan", cents: 599 },
  ],
  ["Total Wine & More  $12.00", { is: "item", description: "Total Wine & More", cents: 1_200 }],
  ["Tax  $10.00", { is: "item", description: "Tax", cents: 1_000 }],
  ["Sales tax (8%)  $8.00", { is: "item", description: "Sales tax (8%)", cents: 800 }],
  ["Total tax  $10.00", { is: "item", description: "Total tax", cents: 1_000 }],
  ["Credit card fee  $3.00", { is: "item", description: "Credit card fee", cents: 300 }],
  ["Paid support add-on  $9.00", { is: "item", description: "Paid support add-on", cents: 900 }],
  // What takes money off, however it is written.
  ["Credit applied  -$5.00", { is: "item", description: "Credit applied", cents: -500 }],
  ["Credit applied  −$5.00", { is: "item", description: "Credit applied", cents: -500 }],
  ["Promo code SAVE10  ($10.00)", { is: "item", description: "Promo code SAVE10", cents: -1_000 }],
  ["Refund  $5.00 CR", { is: "item", description: "Refund", cents: -500 }],
  ["Coupon  $5.00-", { is: "item", description: "Coupon", cents: -500 }],
  // A number in a name stays; a quantity comes off only where the layout marks it.
  ["Office 365  $20.00", { is: "item", description: "Office 365", cents: 2_000 }],
  [
    "Office 365 Business Premium  $22.00",
    { is: "item", description: "Office 365 Business Premium", cents: 2_200 },
  ],
  ["Plan 1  $10.00", { is: "item", description: "Plan 1", cents: 1_000 }],
  ["Plan 2  $20.00", { is: "item", description: "Plan 2", cents: 2_000 }],
  ["Windows Server 2022  $15.00", { is: "item", description: "Windows Server 2022", cents: 1_500 }],
  [
    "Pro plan (1 seat)          1      $20.00",
    { is: "item", description: "Pro plan (1 seat)", cents: 2_000 },
  ],
  ["Seats | 3 | $30.00", { is: "item", description: "Seats", cents: 3_000 }],
  ["Seats x 3  $30.00", { is: "item", description: "Seats", cents: 3_000 }],
  ["Seats ×3  $30.00", { is: "item", description: "Seats", cents: 3_000 }],
  ["Seats 3 x $10.00  $30.00", { is: "item", description: "Seats 3", cents: 3_000 }],
  [
    "Bandwidth, 150 GB    150    $0.40/GB    $60.00",
    { is: "item", description: "Bandwidth, 150 GB", cents: 6_000 },
  ],
  // Leaders, bullets and separators come off the ends, not the name.
  ["Support ........ $50.00", { is: "item", description: "Support", cents: 5_000 }],
  ["• Hosting - monthly  $12.00", { is: "item", description: "Hosting - monthly", cents: 1_200 }],
  ["Acme Inc.  $4.00", { is: "item", description: "Acme Inc.", cents: 400 }],
];

describe("an invoice's summary lines", () => {
  it.each(sums)("%s is a sum of the lines: no item, not the total", (line) => {
    for (const written of [line, line.toUpperCase(), line.toLowerCase()]) {
      expect(read(written), written).toEqual({ lines: [FILLER], total: null });
    }
  });

  it.each(totals)("%s is the total charged", (line) => {
    for (const written of [line, line.toUpperCase(), line.toLowerCase()]) {
      expect(read(written), written).toEqual({ lines: [FILLER], total: 10_000 });
    }
  });

  it("keeps the total charged when a total before tax comes first or after", () => {
    for (const order of [
      "Plan  $90.00\nPre-tax total  $90.00\nTax  $10.00\nTotal  $100.00",
      "Plan  $90.00\nTax  $10.00\nTotal  $100.00\nPre-tax total  $90.00",
      "Plan  $90.00\nTotal excluding tax  $90.00\nTax  $10.00\nAmount due  $100.00",
    ]) {
      const invoice = readInvoice(order)!;
      expect(invoice.totalCents, order).toBe(10_000);
      expect(
        invoice.lines.map((l) => l.description),
        order,
      ).toEqual(["Plan", "Tax"]);
      expect(invoice.linesCents, order).toBe(10_000);
    }
  });
});

describe("an invoice's items", () => {
  it.each(items)("%s", (line, expected) => {
    const { lines, total } = read(line);
    expect(total).toBeNull();
    expect(lines[0]).toEqual({
      description: (expected as { description: string }).description,
      cents: (expected as { cents: number }).cents,
    });
    expect(lines).toHaveLength(2);
  });

  it("keeps two items that differ only by a number apart", () => {
    const invoice = readInvoice("Plan 1  $10.00\nPlan 2  $20.00\nTotal  $30.00")!;
    expect(invoice.lines.map((l) => l.description)).toEqual(["Plan 1", "Plan 2"]);
  });

  it("reads a discount with no minus as taking money off when that makes the lines add up", () => {
    const invoice = readInvoice("Plan  $100.00\nDiscount  $10.00\nTotal  $90.00")!;
    expect(invoice.lines).toEqual([
      { description: "Plan", cents: 10_000 },
      { description: "Discount", cents: -1_000 },
    ]);
    expect(invoice.linesCents).toBe(9_000);
  });

  it("leaves a fee that merely looks like a credit alone when the lines add up as written", () => {
    const invoice = readInvoice("Plan  $100.00\nCredit card fee  $3.00\nTotal  $103.00")!;
    expect(invoice.lines.map((l) => l.cents)).toEqual([10_000, 300]);
  });

  it("leaves signs alone when flipping wouldn't make the lines add up", () => {
    const invoice = readInvoice("Plan  $100.00\nDiscount  $10.00\nTotal  $95.00")!;
    expect(invoice.lines.map((l) => l.cents)).toEqual([10_000, 1_000]);
  });
});
