import { describe, expect, it } from "vitest";
import { claimedSources } from "./claimed-sources";

// Words that name a source or a thing the person's data doesn't have (./claimed-sources.ts), on the
// walkers' own cases (debug 2's desktop sweeps 5 and 7; debug 3's kind (b), 69 to 71).

// As the snapshot flattens it (./diff.ts): a list's items by index.
const onFile = (has: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(has).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((item, i) => [`onFile.${k}.${i}`, item]) : [[`onFile.${k}`, v]],
    ),
  );

describe("a source or a thing named without it on file", () => {
  it("fails a broker's figure for a typed balance (69)", () => {
    expect(
      claimedSources({
        ...onFile({ linkedBank: true, linkedInvestments: false }),
        "trees.taxes.summaries.estimate:investments":
          "Investments: Realized $0.00 … Not yet sold $0.00, from the cost basis your broker reports.",
      }),
    ).toEqual([
      `trees.taxes.summaries.estimate:investments: "your broker reports" without a linked investment account on file, in "Investments: Realized $0.00 … Not yet sold $0.00, from the cost basis your broker reports."`,
    ]);
  });

  it("fails 'the balance they report' beside a typed investment balance, with checking linked (70)", () => {
    expect(
      claimedSources({
        ...onFile({ linkedBank: true, linkedInvestments: false }),
        "trees.money.summaries.have:investments":
          "Investments · Retirement and investment accounts, at the balance they report.",
      }),
    ).toHaveLength(1);
  });

  it("fails 'card fees' with no card (71)", () => {
    expect(
      claimedSources({
        ...onFile({ card: false, statements: true }),
        "suggestions.cost:bank_fees.headline": "Stop paying bank and card fees, save $144/yr",
      }),
    ).toEqual([
      `suggestions.cost:bank_fees.headline: "card fees" without a card on file, in "Stop paying bank and card fees, save $144/yr"`,
    ]);
  });

  it("fails a loan, an employer or statements the data doesn't have", () => {
    const found = claimedSources({
      ...onFile({ statements: false, loans: ["student"] }),
      "suggestions.debt:auto_refinance.short": "Your car payment is $345.12 a month.",
      "suggestions.retirement:employer_match.why": "Your employer matches half of what you put in.",
      "home.cashFlow.empty": "Your statements end Sep 11, 2026.",
    });
    expect(found.map((f) => f.split(": ")[0])).toEqual([
      "suggestions.debt:auto_refinance.short",
      "suggestions.retirement:employer_match.why",
      "home.cashFlow.empty",
    ]);
  });
});

describe("a source or a thing the data has, asked about, or said to be missing", () => {
  it("passes what's on file", () => {
    expect(
      claimedSources({
        ...onFile({
          linkedBank: true,
          linkedInvestments: true,
          card: true,
          loans: ["auto", "student"],
        }),
        "profile.facts.employer.value": "Acme Corp",
        "suggestions.debt:card_rate_check.why":
          "Your bank reports 26.99% on $1,940.20 of card balance.",
        "trees.taxes.summaries.estimate:investments": "From the cost basis your broker reports.",
        "suggestions.debt:auto_refinance.short": "Your car payment is $345.12 a month.",
        "suggestions.debt:student_repayment.title":
          "Compare an income-driven plan for your student loans",
        "suggestions.retirement:employer_match.why":
          "Your employer matches half of what you put in.",
      }),
    ).toEqual([]);
  });

  it("passes a question, an if, and a thing said to be missing", () => {
    expect(
      claimedSources({
        ...onFile({ card: false, loans: [] }),
        "suggestions.debt:x.why": "Do you have a mortgage? If your card charges a fee, ask.",
        "suggestions.debt:y.why": "There's no card on file, so your card fees aren't counted.",
        "home.connect.line": "Upload your statements to see more.",
      }),
    ).toEqual([]);
  });
});
