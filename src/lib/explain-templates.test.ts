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
