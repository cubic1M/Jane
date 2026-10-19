import { describe, expect, it } from "vitest";
import {
  checkGuardrails,
  dollarFigures,
  isAdvice,
  recommendsAChoice,
  unsupportedFigures,
} from "./guardrails";

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

// Spec step 98: the demo advice profile, for people in demo advice mode only.
describe("the demo advice profile", () => {
  const demoIssues = (text: string, allowed: number[] = ALLOWED) => {
    const result = checkGuardrails(text, allowed, undefined, "demo_advice");
    return result.ok ? [] : result.issues;
  };

  it.each([
    // Investments
    "Put the money into an S&P 500 index fund instead.",
    "I'd open a Roth IRA and invest $155 a month.",
    "Rebalance toward bonds: your allocation is heavy in stocks.",
    // Taxes
    "Claim the home office deduction; it's tax deductible.",
    "Bump your 401(k) to lower your taxable income.",
    // Insurance
    "I'd raise your deductible and switch carriers to lower the premium.",
    "Add liability insurance to your car policy.",
    // Loans
    "I recommend refinancing the car loan at a lower interest rate.",
    "You should pay the 24% APR card first: it's the best strategy.",
  ])("lets %j through", (text) => {
    expect(demoIssues(text, [15_500])).toEqual([]);
    // And it's labelled as demo advice.
    expect(isAdvice(text)).toBe(true);
  });

  it("still blocks unsupported figures, promised outcomes and legal advice", () => {
    expect(demoIssues("An index fund could earn $9,999.")).toEqual(["unsupported_dollar_figure"]);
    expect(demoIssues("This fund is guaranteed to beat inflation.")).toEqual([
      "guaranteed_outcome",
    ]);
    expect(demoIssues("Refinance and you will save on interest.")).toEqual(["guaranteed_outcome"]);
    expect(demoIssues("A risk-free return on bonds.")).toEqual(["guaranteed_outcome"]);
    expect(demoIssues("Talk to a lawyer and sue the lender.")).toEqual(["tax_or_legal_advice"]);
  });

  it("still requires a card's wording", () => {
    expect(checkGuardrails("Your bill is high.", [], "bill_negotiation", "demo_advice")).toEqual({
      ok: false,
      issues: ["missing_required_wording"],
    });
  });

  it("lets a recommendation through only in the demo profile", () => {
    expect(recommendsAChoice("I recommend the avalanche plan.")).toBe(true);
    expect(recommendsAChoice("I recommend the avalanche plan.", "demo_advice")).toBe(false);
  });
});

describe("isAdvice", () => {
  it.each([
    "Put it in an index fund.",
    "Your taxes could be lower.",
    "Your car insurance premium went up.",
    "Refinance the mortgage.",
    "I recommend the cheaper plan.",
  ])("labels %j as advice", (text) => {
    expect(isAdvice(text)).toBe(true);
  });

  it("leaves everyday answers unlabelled", () => {
    expect(isAdvice("You spent $15.49 on Netflix this month.")).toBe(false);
    expect(isAdvice("You have $1,234.56 to spend until Oct 30.")).toBe(false);
  });
});
