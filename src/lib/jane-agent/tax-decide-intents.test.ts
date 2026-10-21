import { describe, expect, it } from "vitest";
import { parseTaxIntent } from "./tax-intents";

const CASES: [string, string][] = [
  ["should I itemize or take the standard deduction", "itemize"],
  ["should I do a Roth conversion this year", "roth_conversion"],
  ["should I adjust my withholding", "withholding"],
  ["do I need to pay estimated taxes", "estimated"],
  ["how much will I owe in taxes this year", "owe"],
  ["how much have I paid in federal tax", "paid"],
  ["how much can I put in my 401k this year", "k401_limit"],
  ["what's my effective tax rate", "effective_rate"],
];

describe("tax decision intents", () => {
  it.each(CASES)("%s", (text, topic) => {
    expect(parseTaxIntent(text.toLowerCase())).toMatchObject({ kind: "tax", ask: "decide", topic });
  });
});
