import { describe, expect, it } from "vitest";
import { sampleFindings } from "./__fixtures__/findings";
import { contentText, parseExplanation } from "./explain";
import { prepareExplainInput } from "./explain-input";
import { templateExplanation } from "./explain-templates";
import { checkGuardrails } from "./guardrails";

describe("templateExplanation", () => {
  it.each(sampleFindings().map((f) => [f.type, f] as const))(
    "gives %s text that passes the guardrails and the length rules",
    (_type, finding) => {
      const { input, allowedCents } = prepareExplainInput(finding);
      const content = templateExplanation(finding.title, input);

      expect(checkGuardrails(contentText(content), allowedCents, finding.type)).toEqual({
        ok: true,
      });
      const asJson = JSON.stringify({
        title: content.title,
        explanation: content.explanation,
        give_up: content.giveUp,
        alternatives: content.alternatives,
      });
      expect(parseExplanation(asJson)).toEqual(content);
    },
  );

  it("says a card charging interest comes into idle cash, without promising a saving", () => {
    const evidence = { excessCents: 3_166_152, referenceRateBps: 400, assumedCurrentRateBps: 50 };
    const words = (extra: object) => {
      const { input, allowedCents } = prepareExplainInput({
        type: "idle_cash",
        annualSavingsCents: null,
        evidence: { ...evidence, ...extra },
      });
      const content = templateExplanation("Extra cash", input);
      expect(checkGuardrails(contentText(content), allowedCents, "idle_cash")).toEqual({
        ok: true,
      });
      return content.explanation;
    };
    expect(words({ cardInterest: true })).toMatch(/while a card charges you interest/);
    expect(words({ cardInterest: true })).not.toMatch(/high-yield savings account paying/);
    expect(words({})).toMatch(/high-yield savings account paying/);
  });

  // "above the typical price of $50.00 to $120.00 for a internet and TV bill".
  it("says an internet bill, not a internet bill", () => {
    const bill = (billKind: string) =>
      templateExplanation(
        "Your bill is above the typical price",
        prepareExplainInput({
          type: "bill_negotiation",
          annualSavingsCents: 54_000,
          evidence: {
            merchant: "Comcast",
            billKind,
            monthlyCents: 16_500,
            typicalLowCents: 5_000,
            typicalHighCents: 12_000,
          },
        }).input,
      ).explanation;
    expect(bill("internet and TV")).toMatch(/for an internet and TV bill\./);
    expect(bill("phone")).toMatch(/for a phone bill\./);
  });

  // Night QA 10-30: "down to about $680.15 around 2026-11-09" for a forecast of -$680.15.
  it("says a low point below zero with its sign, on a day people read", () => {
    const { input, allowedCents } = prepareExplainInput({
      type: "low_balance_risk",
      annualSavingsCents: null,
      evidence: { balanceCents: 79_847, lowestCents: -68_015, lowestDate: "2026-11-09" },
    });
    const content = templateExplanation(
      "Chase checking could drop to -$680.15 around Nov 9",
      input,
    );
    expect(content.explanation).toMatch(/down to about -\$680\.15 around Nov 9,/);
    expect(checkGuardrails(contentText(content), allowedCents, "low_balance_risk")).toEqual({
      ok: true,
    });
  });

  it("says the months a fee or interest total covers, never a year it doesn't", () => {
    const fees = templateExplanation("$36.00 in fees on BofA checking in the last 3 months", {
      findingType: "bank_fees",
      savingsPerYear: "$144.00",
      facts: { account: "bank account", total: "$36.00", period: "the last 3 months" },
      charges: [],
    });
    expect(fees.explanation).toMatch(
      /^Your bank or card company charged you \$36\.00 in fees in the last 3 months\./,
    );
    const interest = templateExplanation("$60.44 in interest", {
      findingType: "card_interest",
      savingsPerYear: "$241.76",
      facts: { account: "credit card", total: "$60.44" },
      charges: [],
    });
    expect(interest.explanation).toMatch(/^You paid \$60\.44 in credit card interest\./);
    expect(`${fees.explanation} ${interest.explanation}`).not.toMatch(/12 months/);
  });

  it("still reads naturally when a figure is missing", () => {
    const content = templateExplanation("Your Geico insurance could cost less", {
      findingType: "insurance_reshop",
      savingsPerYear: null,
      facts: {},
      charges: [],
    });

    expect(content.explanation).toBe(
      "You pay your insurer regularly for insurance. Comparing quotes with the same coverage often finds a lower price.",
    );
  });
});

// Debugger 11-04: "Is Northstar Data a subscription to cancel?" read on with "You pay Northstar Data
// $49.00 monthly, every year" and "You would lose access", as if the answer were known.
describe("a charge that may not be a subscription", () => {
  const input = (facts: Record<string, string>, savingsPerYear: string | null = null) =>
    ({ findingType: "subscription_review", savingsPerYear, facts }) as never;
  const guess = templateExplanation(
    "Is Northstar Data a subscription to cancel?",
    input({
      merchant: "Northstar Data",
      latestCharge: "$49.00",
      billed: "monthly",
      onlyItsPrice: "yes",
      yearlyCost: "$588.00",
    }),
  );

  it("says what it costs and that Jane can't tell", () => {
    expect(guess.explanation).toContain("about $588.00 a year");
    expect(guess.explanation).toContain("can't tell");
    expect(guess.explanation).not.toContain("every year");
  });

  it("doesn't assume what it would cost to stop", () => {
    expect(guess.giveUp).toContain("If it is one");
  });

  it("leaves a known subscription as it was", () => {
    const known = templateExplanation(
      "Review your Netflix subscription",
      input({ merchant: "Netflix", latestCharge: "$15.49", billed: "monthly" }, "$185.88"),
    );
    expect(known.explanation).toContain("about $185.88 a year");
    expect(known.giveUp).toBe("You would lose access to Netflix.");
  });

  it("passes the guardrails with the finding's own figures", () => {
    const [sample] = sampleFindings().filter((f) => f.type === "subscription_review");
    const finding = {
      ...sample,
      annualSavingsCents: null,
      evidence: { ...(sample.evidence as object), onlyItsPrice: true },
    };
    const { input: prepared, allowedCents } = prepareExplainInput(finding);
    const content = templateExplanation(finding.title, prepared);
    expect(content.giveUp).toContain("If it is one");
    expect(checkGuardrails(contentText(content), allowedCents, finding.type)).toEqual({ ok: true });
  });
});
