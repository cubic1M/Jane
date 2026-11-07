import { describe, expect, it } from "vitest";
import { parseTranscript } from "./irs-transcript/parse";
import { W2_NEXT_LINE, W2_SAME_LINE } from "./tax-form-upload/__fixtures__/forms";
import { parseTaxForm } from "./tax-form-upload/parse";

// An uploaded W-2, 1099 or IRS transcript is text the person (or whoever made the file) controls,
// up to 2 MB. One long line of digits or spaces made the readers' patterns retry from every
// position: 40,000 characters took a second, and the 2 MB the readers accept would hold a server
// for most of an hour. These lines are a twentieth of that cap, which the old patterns took
// seconds on; read in one pass, each is a few milliseconds.

const LONG = 100_000;

function elapsedMs(read: () => unknown): number {
  const start = performance.now();
  try {
    read();
  } catch {
    // A refusal is fine; only the time counts here.
  }
  return performance.now() - start;
}

describe("a crafted tax upload is read in one pass", () => {
  it.each([
    [
      "digits after a W-2 box label",
      `Form W-2\n1 Wages, tips, other compensation ${"1".repeat(LONG)}`,
    ],
    [
      "spaces after a W-2 box label",
      `Form W-2\n1 Wages, tips, other compensation${" ".repeat(LONG)}x`,
    ],
    [
      "digits and commas after a 1099 box",
      `Form 1099-INT\n1 Interest income ${"1,".repeat(LONG / 2)}`,
    ],
  ])("a W-2 or 1099 with %s", (_, text) => {
    expect(elapsedMs(() => parseTaxForm(text))).toBeLessThan(250);
  });

  it.each([
    [
      "spaces after a code",
      `Account Transcript\nTAX PERIOD: Dec. 31, 2024\n150${" ".repeat(LONG)}x`,
    ],
    ["dates and no amount", `Account Transcript\n150 ${"01-01-2024  ".repeat(LONG / 12)}`],
  ])("an IRS transcript with %s", (_, text) => {
    expect(elapsedMs(() => parseTranscript(text))).toBeLessThan(250);
  });

  it("still reads a W-2's amounts on the label's line or the next one", () => {
    expect(parseTaxForm(W2_SAME_LINE).boxes).toMatchObject({
      wages: 6_124_000,
      federalWithheld: 612_050,
      stateWithheld: 245_010,
    });
    expect(parseTaxForm(W2_NEXT_LINE).boxes).toEqual({
      wages: 4_800_000,
      federalWithheld: 420_000,
    });
  });

  it("still reads an amount without a comma, with a dollar sign, or below zero", () => {
    const form = (amount: string) =>
      parseTaxForm(`Form 1099-INT\n1 Interest income ${amount}\n`).boxes.interest;
    expect(form("843.27")).toBe(84_327);
    expect(form("$1,204.11")).toBe(120_411);
    expect(form("12345.67")).toBe(1_234_567);
    expect(form("-12.00")).toBe(-1_200);
  });

  it("still reads a transcript row next to a long line", () => {
    const text = [
      "Account Transcript",
      "TAX PERIOD: Dec. 31, 2024",
      `note ${"x".repeat(LONG)}`,
      "806 W-2 or 1099 withholding 04-15-2025 -$4,200.00",
    ].join("\n");
    expect(parseTranscript(text).lines).toEqual([
      { code: "806", what: "Withholding", on: "2025-04-15", cents: -420_000 },
    ]);
  });
});
