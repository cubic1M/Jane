import { describe, expect, it } from "vitest";
import { MODEL_PRICES_CENTS } from "@/config/answer-checks";
import { costInHundredthsOfCents } from "./spend";

// Spec step 191: what a Claude answer costs, at the model's listed price.

describe("what one Claude call costs", () => {
  it("is tokens times the listed price, in hundredths of a cent", () => {
    const { input, output } = MODEL_PRICES_CENTS["claude-sonnet-5-5"];
    // 10,000 tokens in and 1,000 out.
    const want = (10_000 * input + 1_000 * output) / 10_000;
    expect(
      costInHundredthsOfCents({
        model: "claude-sonnet-5-5",
        inputTokens: 10_000,
        outputTokens: 1_000,
      }),
    ).toBe(Math.ceil(want));
  });

  it("charges cached input a tenth, and counts a model that isn't listed at the dearest price", () => {
    const cached = costInHundredthsOfCents({
      model: "claude-sonnet-5-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 100_000,
    });
    const plain = costInHundredthsOfCents({
      model: "claude-sonnet-5-5",
      inputTokens: 100_000,
      outputTokens: 0,
    });
    expect(cached).toBe(Math.ceil(plain / 10));
    const unlisted = costInHundredthsOfCents({
      model: "claude-future",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(unlisted).toBe(Math.max(...Object.values(MODEL_PRICES_CENTS).map((p) => p.input)) * 100);
  });
});
