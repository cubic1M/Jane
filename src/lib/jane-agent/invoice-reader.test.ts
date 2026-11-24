import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { lookUpCharge } from "./charge-explain";
import { readAgainst, readInvoice, readingWords } from "./invoice-reader";
import type { BillLine } from "./replies-old-bills";

// Reading a pasted invoice, set against the charge it is for (founder 11-24).

const charge = (id: string, date: string, dollars: number): BillLine => ({
  id,
  date,
  amountCents: Math.round(dollars * 100),
  description: "VERCEL INC",
  merchantName: "Vercel",
  pfcDetailed: null,
});
const history = [
  charge("v1", "2026-08-20", 20),
  charge("v2", "2026-09-20", 20),
  charge("v3", "2026-10-20", 20),
  charge("v4", "2026-11-20", 100),
];
const found = lookUpCharge("vercel", history, { amountCents: 10_000, day: null });
const explanation = found.kind === "found" ? found.explanation : null;

const INVOICE = `Vercel Inc.
Invoice #INV-0042   Nov 20, 2026
Description                       Qty      Unit price     Amount
Pro plan (1 seat)                 1        $20.00         $20.00
Bandwidth overage, 150 GB         150      $0.40/GB       $60.00
Build minutes, 400 min            400      $0.05 per min  $20.00
Subtotal                                                  $100.00
Tax                                                       $0.00
Total                                                     $100.00
`;

const words = (text: string, charge = explanation) => {
  const invoice = readInvoice(text)!;
  const body = readingWords(readAgainst(invoice, charge)).join("\n");
  const guard = checkGuardrails(
    body,
    dollarFigures(body).map((f) => f.cents),
    undefined,
    "standard",
  );
  expect(guard.ok ? [] : guard.issues, body).toEqual([]);
  return body;
};

describe("reading an invoice", () => {
  it("lists the line items and the total, not the header, the subtotal or a unit price", () => {
    const invoice = readInvoice(INVOICE)!;
    expect(invoice.lines).toEqual([
      { description: "Pro plan (1 seat)", cents: 2_000 },
      { description: "Bandwidth overage, 150 GB", cents: 6_000 },
      { description: "Build minutes, 400 min", cents: 2_000 },
      { description: "Tax", cents: 0 },
    ]);
    expect(invoice.totalCents).toBe(10_000);
    expect(invoice.linesCents).toBe(10_000);
  });

  it("reads a credit by its minus or brackets, and the total however it is said", () => {
    const invoice = readInvoice(
      "Team plan  $50.00\nCredit applied  -$5.00\nPromo (10.00)\nAmount due  $35.00",
    )!;
    expect(invoice.lines.map((l) => l.cents)).toEqual([5_000, -500, -1_000]);
    expect(invoice.totalCents).toBe(3_500);
    expect(invoice.linesCents).toBe(3_500);
  });

  it("reads amounts with thousands separators and with no dollar sign", () => {
    const invoice = readInvoice("Annual plan   1,200.00\nTotal 1,200.00")!;
    expect(invoice.lines).toEqual([{ description: "Annual plan", cents: 120_000 }]);
    expect(invoice.totalCents).toBe(120_000);
  });

  it("reads nothing from text with no amounts, and from a bare number", () => {
    expect(readInvoice("Thanks for your business!")).toBeNull();
    expect(readInvoice("$100.00")).toBeNull();
    expect(readInvoice("Total $100.00")).toBeNull();
  });

  it("reads only so many lines", () => {
    const many = Array.from({ length: 200 }, (_, i) => `Item ${i}  $1.00`).join("\n");
    expect(readInvoice(many)!.lines.length).toBeLessThanOrEqual(80);
  });
});

describe("set against the charge", () => {
  it("names the lines that make up the extra over the usual, and the one that is the usual", () => {
    const body = words(INVOICE);
    expect(body).toContain("The invoice lists 4 lines:");
    expect(body).toContain("Together they come to $100.00, its total.");
    expect(body).toContain("The Pro plan (1 seat) ($20.00) line matches what you usually pay.");
    expect(body).toContain(
      "The other lines (Bandwidth overage, 150 GB ($60.00); Build minutes, 400 min ($20.00); Tax ($0.00)) make up the extra $80.00.",
    );
  });

  it("names the one line that is the whole extra", () => {
    const body = words("Pro plan  $20.00\nOverage, 80 GB  $80.00\nTotal  $100.00");
    expect(body).toContain("The Pro plan ($20.00) line matches what you usually pay.");
    expect(body).toContain("The Overage, 80 GB ($80.00) line accounts for the extra $80.00.");
  });

  it("says the other lines make up the extra when no one line is it", () => {
    const body = words(
      "Pro plan  $20.00\nBandwidth  $60.00\nBuild minutes  $20.00\nTotal  $100.00",
    );
    expect(body).toContain("The Pro plan ($20.00) line matches what you usually pay.");
    expect(body).toContain(
      "The other lines (Bandwidth ($60.00); Build minutes ($20.00)) make up the extra $80.00.",
    );
  });

  it("won't name a line when the total isn't the charge", () => {
    const body = words("Pro plan  $20.00\nOverage  $50.00\nTotal  $70.00");
    expect(body).toContain("That isn't the $100.00 you were charged");
    expect(body).toContain("I won't say which line explains the charge");
    expect(body).not.toContain("accounts for");
  });

  it("says it can't tell when no line is the usual or the extra", () => {
    const body = words("Plan A  $45.00\nPlan B  $55.00\nTotal  $100.00");
    expect(body).toContain("None of its lines is your usual or the extra $80.00");
  });

  it("notes lines it may have missed when they don't add up to the total", () => {
    const body = words("Pro plan  $20.00\nTotal  $100.00");
    expect(body).toContain("the lines I could read come to $20.00, so I may have missed one");
  });

  it("with no charge to set it against, lists only what it read", () => {
    const body = words(INVOICE, null);
    expect(body).not.toMatch(/usual|extra/);
  });
});
