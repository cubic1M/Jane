import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, unsupportedFigures } from "./guardrails";

const ALLOWED = [1549, 18588];

const issuesOf = (text: string, allowed: number[] = ALLOWED) => {
  const result = checkGuardrails(text, allowed);
  return result.ok ? [] : result.issues;
};

describe("checkGuardrails", () => {
  it("passes a plain explanation that uses the finding's own figures", () => {
    expect(
      checkGuardrails(
        "You pay Netflix $15.49 a month, about $186 a year. Cancelling could save $185.88 a year.",
        ALLOWED,
      ),
    ).toEqual({ ok: true });
  });

  describe("(a) investments", () => {
    it.each([
      "Put the money into an S&P 500 index fund instead.",
      "Consider buying Apple stock.",
      "You could invest the difference.",
      "Move it into bitcoin.",
      "A Roth IRA would grow faster.",
      "Treasury bills pay more right now.",
      "Sell your shares before the end of the year.",
      "Hold onto those positions.",
      "It's a good time to rebalance.",
      "Your asset allocation looks heavy.",
      "Your account outperformed last year.",
    ])("rejects %j", (text) => {
      expect(issuesOf(text)).toContain("investment_advice");
    });

    it("allows savings accounts and CDs, which are bank deposits", () => {
      expect(issuesOf("A high-yield savings account or a CD pays more interest.")).toEqual([]);
    });

    it("allows everyday words like being on hold or keeping a plan", () => {
      for (const text of [
        "Jane was on hold for ten minutes.",
        "Keep your current plan.",
        "Switch to a cheaper option.",
      ]) {
        expect(issuesOf(text), text).toEqual([]);
      }
    });
  });

  describe("(b) tax and legal advice", () => {
    it.each([
      "This fee is tax deductible.",
      "You can write off the subscription.",
      "Claim it as a deduction.",
      "Ask the IRS about it.",
      "You may have legal grounds to sue the bank.",
      "Talk to a lawyer about the late fees.",
    ])("rejects %j", (text) => {
      expect(issuesOf(text)).toContain("tax_or_legal_advice");
    });
  });

  it("allows an insurance deductible", () => {
    expect(issuesOf("Raising your deductible lowers the premium.")).toEqual([]);
  });

  it("allows liability cover on a policy, but not being liable", () => {
    expect(issuesOf("It has liability cover only.")).toEqual([]);
    expect(issuesOf("Injury liability, per person: 50 thousand.")).toEqual([]);
    expect(issuesOf("Personal liability coverage is included.")).toEqual([]);
    expect(issuesOf("You may be liable for the damage.")).toContain("tax_or_legal_advice");
    expect(issuesOf("Your liability here is limited by law.")).toContain("tax_or_legal_advice");
  });

  describe("(c) dollar figures", () => {
    it("rejects a figure that matches nothing in the evidence or estimate", () => {
      expect(issuesOf("Cancelling could save $250 a year.")).toEqual(["unsupported_dollar_figure"]);
    });

    it("rejects a figure off by a cent", () => {
      expect(issuesOf("You pay $15.48 a month.")).toEqual(["unsupported_dollar_figure"]);
    });

    it("rejects a figure written in words or with a k suffix", () => {
      expect(issuesOf("That is about 300 dollars.")).toEqual(["unsupported_dollar_figure"]);
      expect(issuesOf("That is about $1.2k a year.", [120_000])).toEqual([
        "unsupported_dollar_figure",
      ]);
    });

    it("allows a whole-dollar rounding of a real amount", () => {
      expect(issuesOf("About $186 a year.")).toEqual([]);
      expect(issuesOf("About $185 a year.")).toEqual([]);
      expect(issuesOf("About $184 a year.")).toEqual(["unsupported_dollar_figure"]);
    });

    it("matches refunds and fees by size", () => {
      expect(issuesOf("A $35.00 overdraft fee.", [-3500])).toEqual([]);
    });
  });

  describe("(d) guaranteed outcomes", () => {
    it.each([
      "You will save $185.88 a year.",
      "We guarantee you'll get the fees back.",
      "This is completely risk-free.",
      "You'll definitely pay less.",
    ])("rejects %j", (text) => {
      expect(issuesOf(text)).toContain("guaranteed_outcome");
    });

    it("allows hedged estimates", () => {
      expect(issuesOf("You could save about $186 a year.")).toEqual([]);
    });
  });

  it("makes bill cards compare with a typical price and never promise a result", () => {
    const ok = "You pay about $165.00 a month, above the typical price for a phone bill.";
    expect(checkGuardrails(ok, [16_500], "bill_negotiation")).toEqual({ ok: true });
    expect(
      checkGuardrails("Your $165.00 phone bill is too high.", [16_500], "bill_negotiation"),
    ).toEqual({ ok: false, issues: ["missing_required_wording"] });
    expect(
      checkGuardrails(`${ok} Asking will save you money.`, [16_500], "bill_negotiation"),
    ).toEqual({ ok: false, issues: ["guaranteed_outcome"] });
    // Other cards don't need the wording.
    expect(checkGuardrails("Your bill went up.", [], "price_increase")).toEqual({ ok: true });
  });

  it("reports every rule that fails", () => {
    expect(issuesOf("You will save $999 by investing it, tax free.")).toEqual([
      "investment_advice",
      "tax_or_legal_advice",
      "unsupported_dollar_figure",
      "guaranteed_outcome",
    ]);
  });
});

describe("dollarFigures", () => {
  it("reads dollar amounts in their common forms", () => {
    expect(dollarFigures("$1,234.56, $15 and 20 dollars").map((f) => f.cents)).toEqual([
      123456, 1500, 2000,
    ]);
  });
});

describe("unsupportedFigures", () => {
  it("lists the amounts nothing supports, as written", () => {
    expect(unsupportedFigures("$15.49 a month, $186 a year, $9.99 or 40 dollars", ALLOWED)).toEqual(
      ["$9.99", "40 dollars"],
    );
    expect(unsupportedFigures("No amounts here.", ALLOWED)).toEqual([]);
  });
});
