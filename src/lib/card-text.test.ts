import { describe, expect, it } from "vitest";
import { findingOfType } from "./__fixtures__/findings";
import { currentHash, explanationFor } from "./card-text";

const CONTENT = {
  title: "Netflix went up",
  explanation: "Netflix now charges $17.99 a month.",
  giveUp: "Nothing.",
  alternatives: [],
};

function row(type: Parameters<typeof findingOfType>[0], overrides: Record<string, unknown> = {}) {
  const f = findingOfType(type);
  return {
    type: f.type,
    title: f.title,
    annualSavingsCents: f.annualSavingsCents,
    evidence: f.evidence,
    explanation: null as unknown,
    explanationHash: null as string | null,
    ...overrides,
  };
}

const hashOf = currentHash;

describe("explanationFor", () => {
  it("shows the stored explanation while the evidence is unchanged", () => {
    const finding = row("price_increase", { explanation: CONTENT });
    finding.explanationHash = hashOf(finding);

    expect(explanationFor(finding)).toEqual(CONTENT);
  });

  it("shows the template once the evidence has changed", () => {
    const finding = row("price_increase", { explanation: CONTENT, explanationHash: "old" });

    expect(explanationFor(finding).title).toBe(finding.title);
    expect(explanationFor(finding).explanation).toContain("raised your price");
  });

  it("shows the template when nothing has been generated yet", () => {
    expect(explanationFor(row("bank_fees")).explanation).toContain("in fees");
  });
});
