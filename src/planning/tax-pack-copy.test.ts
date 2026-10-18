import { describe, expect, it } from "vitest";
import { recommendsAChoice } from "@/lib/guardrails";
import { TAX_PACK_COPY, allTaxPackCopy } from "./tax-pack-copy";

const FORBIDDEN = [/deductible/i, /deductions?/i, /write[- ]?offs?/i, /you should/i, /allowed/i];

describe("tax-time pack wording", () => {
  it.each(allTaxPackCopy())("never says what counts or what to do: %s", (text) => {
    for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
    expect(recommendsAChoice(text)).toBe(false);
  });

  it("carries the disclaimer, on the page and in the alert", () => {
    expect(TAX_PACK_COPY.disclaimer).toBe(
      "Spending people often show their tax preparer. Jane doesn't know your tax situation; this is not tax advice.",
    );
    expect(TAX_PACK_COPY.notAdvice).toContain("this is not tax advice.");
    expect(allTaxPackCopy().at(-1)).toContain("this is not tax advice.");
  });
});
