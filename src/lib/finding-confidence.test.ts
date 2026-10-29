import { describe, expect, it } from "vitest";
import { FINDING_CONFIDENCE_PERCENT } from "@/config/detection";
import { findingConfidence } from "./finding-confidence";

// Every finding on the report says how sure Jane is, as a percentage with what it rests on.
describe("findingConfidence", () => {
  it("gives each level its figure, high above medium above low", () => {
    const of = (confidence: "low" | "medium" | "high") =>
      findingConfidence({ confidence, evidence: {} }).percent;
    expect(of("high")).toBe(FINDING_CONFIDENCE_PERCENT.high);
    expect(of("high")).toBeGreaterThan(of("medium"));
    expect(of("medium")).toBeGreaterThan(of("low"));
    // Read back as the same level a suggestion's percentage would be (80+ high, 50+ medium).
    expect(of("high")).toBeGreaterThanOrEqual(80);
    expect(of("medium")).toBeGreaterThanOrEqual(50);
    expect(of("medium")).toBeLessThan(80);
    expect(of("low")).toBeLessThan(50);
  });

  it("says what it rests on: the transactions, else the accounts", () => {
    const tx = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
    expect(findingConfidence({ confidence: "high", evidence: { transactions: tx(14) } })).toEqual({
      percent: 90,
      reason: "based on 14 transactions",
    });
    expect(findingConfidence({ confidence: "low", evidence: { transactions: tx(1) } }).reason).toBe(
      "based on 1 transaction",
    );
    expect(
      findingConfidence({ confidence: "medium", evidence: { accounts: [{ id: "a" }] } }).reason,
    ).toBe("based on 1 account");
    expect(findingConfidence({ confidence: "medium", evidence: null }).reason).toBe(
      "based on your accounts",
    );
  });
});
