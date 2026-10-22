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
  ["will I get a refund", "refund"],
  ["how much tax will I owe", "owe"],
  ["what can I deduct", "deductions"],
  ["how much should I set aside for taxes", "setaside"],
  ["can I take a home office", "home_office"],
  ["should I itemize", "itemize"],
  ["should I harvest my losses", "harvest"],
  ["should I appeal my property taxes", "property"],
  ["mortgage interest deduction on my taxes", "mortgage_interest"],
];

describe("tax decision intents", () => {
  it.each(CASES)("%s", (text, topic) => {
    expect(parseTaxIntent(text.toLowerCase())).toMatchObject({ kind: "tax", ask: "decide", topic });
  });

  it.each(["do I owe tax on my bitcoin", "do I owe taxes in two states"])(
    "%s stays with its own answer",
    (text) => {
      expect(parseTaxIntent(text.toLowerCase())).not.toMatchObject({ ask: "decide" });
    },
  );
});

describe("tax decisions through the decision router", () => {
  it("reads the sector's subject, and hands the words after 'should I' back to the tax rules", async () => {
    const { parseDecision } = await import("./decision-intents");
    for (const [q, topic] of [
      ["should I do a Roth conversion this year", "roth_conversion"],
      ["should I itemize or take the standard deduction", "itemize"],
      ["should I adjust my withholding", "withholding"],
    ] as const) {
      const d = parseDecision(q.toLowerCase());
      expect(d, q).toMatchObject({ kind: "decision", item: "tax" });
      expect(parseTaxIntent(`should i ${d!.label}`), q).toMatchObject({ ask: "decide", topic });
    }
  });
});
