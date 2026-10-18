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
