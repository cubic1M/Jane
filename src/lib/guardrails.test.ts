import { describe, expect, it } from "vitest";
import { APPROVED_DEBT_SENTENCES, COUNSEL_POINTER, DEBT_FACTS } from "@/config/debt-trouble";
import { FEDERAL_ESTATE_FACT, STATE_DEATH_TAXES } from "@/config/inheritance";
import {
  checkGuardrails,
  dollarFigures,
  guardrailMatches,
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
      "You can take the lender to court over the late fees.",
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

  // Spec step 268: inherited money and gifts are tax facts plus a pointer to counsel; what to do
  // about the estate is legal advice, blocked even as demo advice.
  it.each([
    "You should set up a revocable trust for the house.",
    "Put the house in a living trust to avoid probate.",
    "Write a will that leaves the IRA to your daughter.",
    "Disclaim the inheritance so it passes to your kids.",
    "Update your power of attorney before the gift.",
  ])("blocks estate advice: %j", (text) => {
    expect(demoIssues(text)).toEqual(["tax_or_legal_advice"]);
  });

  it("lets the inheritance facts and the pointer to counsel through", () => {
    for (const text of [
      "Most heirs must empty an inherited IRA within 10 years of the owner's death.",
      "Inherited stocks get a new cost basis: their value on the day the owner died.",
      "A gift over the annual exclusion takes a gift tax return (Form 709).",
      "An estate lawyer can say what applies to a particular family.",
      // Answer-check sweep: the reviewed estate tax fact was refused for naming the estate tax.
      FEDERAL_ESTATE_FACT,
      ...Object.values(STATE_DEATH_TAXES),
    ])
      expect(demoIssues(text), text).toEqual([]);
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

// Spec step 93: fewer false blocks. Rules narrowed where they blocked good answers, each
// still blocking what it's for.
describe("narrowed rules", () => {
  const issues = (text: string) => {
    const result = checkGuardrails(text, []);
    return result.ok ? [] : result.issues;
  };

  it("allows a paycheck's deductions, a food court, Sue, and getting paid", () => {
    expect(issues("Your paycheck after payroll deductions lands Nov 1.")).toEqual([]);
    expect(issues("Those are the deductions from your paycheck.")).toEqual([]);
    expect(issues("Most of it went to the food court at the mall.")).toEqual([]);
    expect(issues("You split the bill with Sue.")).toEqual([]);
    expect(issues("You'll get paid on Nov 1.")).toEqual([]);
  });

  it("still blocks tax deductions, courts, suing and promised savings", () => {
    expect(issues("You can claim it as a deduction.")).toEqual(["tax_or_legal_advice"]);
    expect(issues("Take them to small claims court.")).toEqual(["tax_or_legal_advice"]);
    expect(issues("You could sue them for it.")).toEqual(["tax_or_legal_advice"]);
    expect(issues("You'll get your money back.")).toEqual(["guaranteed_outcome"]);
  });
});

// Spec step 229: facts about settlement and bankruptcy pass only as the reviewed sentences;
// advice about them, legal advice and promised outcomes never do.
describe("debt trouble facts", () => {
  const standard = (text: string) => issuesOf(text, []);
  const demo = (text: string) => {
    const result = checkGuardrails(text, [], undefined, "demo_advice");
    return result.ok ? [] : result.issues;
  };

  it("lets each reviewed sentence through, in every profile", () => {
    for (const sentence of APPROVED_DEBT_SENTENCES) {
      expect(standard(sentence), sentence).toEqual([]);
      expect(demo(sentence), sentence).toEqual([]);
    }
    expect(standard(`Here is what it means. - ${DEBT_FACTS.bankruptcy[0].text}`)).toEqual([]);
  });

  it("blocks legal advice about bankruptcy and settlement", () => {
    for (const text of [
      "You should file for bankruptcy.",
      "Chapter 7 is the right move for you.",
      "Stop paying your cards and settle for less.",
      "You don't need a lawyer for this.",
      "A debt settlement company can get this cleared.",
      "The lender can't take you to court over it.",
      "You can't be sued for this debt.",
    ]) {
      expect(standard(text), text).toContain("tax_or_legal_advice");
      expect(demo(text), text).toContain("tax_or_legal_advice");
    }
  });

  it("checks anything added to or changed in a reviewed sentence", () => {
    const [first] = DEBT_FACTS.bankruptcy;
    expect(standard(`${first.text} Chapter 13 is right for you.`)).toContain("tax_or_legal_advice");
    expect(standard(first.text.replace("many debts", "all your debts"))).toContain(
      "tax_or_legal_advice",
    );
    expect(standard(`${COUNSEL_POINTER} It's definitely the answer.`)).toContain(
      "guaranteed_outcome",
    );
  });
});

describe("saying Jane can't do something legal", () => {
  const demo = (text: string) => checkGuardrails(text, [], undefined, "demo_advice");

  it("lets a refusal and a pointer to a lawyer through", () => {
    expect(demo("I can't write a will for you. A lawyer can draw one up.").ok).toBe(true);
    expect(demo("That's not something I can do, so talk to an estate attorney about it.").ok).toBe(
      true,
    );
  });

  it("lets a kind answer to a death through when it leaves the legal part to an attorney", () => {
    expect(
      demo(
        "I'm so sorry about your mom. For her accounts, an estate attorney can tell you the steps, and each bank has a team for this.",
      ).ok,
    ).toBe(true);
  });

  it("still blocks legal advice of its own, even next to a refusal", () => {
    expect(demo("You should sue the landlord.").ok).toBe(false);
    expect(demo("I can't write that for you, but you should sue them and file in court.").ok).toBe(
      false,
    );
    expect(demo("Legally you can stop paying your credit cards.").ok).toBe(false);
  });

  it("no longer reads 'stop paying overdraft fees' as legal trouble", () => {
    expect(demo("You can stop paying overdraft fees by turning on a low-balance alert.").ok).toBe(
      true,
    );
    expect(demo("You could stop paying your credit cards.").ok).toBe(false);
  });
});

describe("refusing to help with something dishonest", () => {
  const refusal = "I can't help hide income from the IRS; that's tax evasion.";
  it("passes in both profiles", () => {
    expect(checkGuardrails(refusal, [], undefined, "demo_advice").ok).toBe(true);
    expect(checkGuardrails(refusal, [], undefined, "standard").ok).toBe(true);
    expect(
      checkGuardrails(
        `${refusal} I can help you find legal deductions.`,
        [],
        undefined,
        "demo_advice",
      ).ok,
    ).toBe(true);
  });

  it("still blocks tax talk that is not a refusal", () => {
    expect(
      checkGuardrails("You could hide income from the IRS.", [], undefined, "standard").ok,
    ).toBe(false);
  });
});

describe("naming a rule of thumb, and who handles the legal part", () => {
  const demo = (t: string) => checkGuardrails(t, [], undefined, "demo_advice");

  it("lets Jane say there is no guarantee, but not promise one", () => {
    expect(demo("The 4% rule, often called a safe withdrawal rate, isn't a guarantee.").ok).toBe(
      true,
    );
    expect(demo("I can't promise it will last, and there's no guarantee.").ok).toBe(true);
    expect(demo("This is guaranteed to last 30 years.").ok).toBe(false);
    expect(demo("You will definitely be fine.").ok).toBe(false);
  });

  it("lets a pointer to who handles it through, in both profiles", () => {
    const pointer = "An estate attorney or the bank's bereavement team handles that part.";
    expect(demo(pointer).ok).toBe(true);
    expect(checkGuardrails(pointer, [], undefined, "standard").ok).toBe(true);
    // Still blocked: telling the person what to do about the law.
    expect(demo("You should file for probate in court yourself.").ok).toBe(false);
  });

  it("reports which rules matched, never the words", () => {
    const rules = guardrailMatches("This is guaranteed and risk-free.", [], "demo_advice");
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.startsWith("guarantee:"))).toBe(true);
  });
});

describe("a lawyer or the word legal is not legal advice", () => {
  it.each([
    "Talk to a lawyer about the late fees.",
    "An estate attorney can handle probate.",
    "The legal side is for an attorney; I can show you the accounts.",
    "There are legal deductions you may qualify for.",
  ])("passes %j in both profiles", (text) => {
    expect(checkGuardrails(text, [], undefined, "demo_advice").ok).toBe(true);
    expect(issuesOf(text, [])).not.toContain("tax_or_legal_advice");
  });

  it.each(["You should sue them.", "You could win the case.", "You are legally entitled to it."])(
    "blocks %j",
    (text) => {
      expect(checkGuardrails(text, [], undefined, "demo_advice").ok).toBe(false);
    },
  );
});
