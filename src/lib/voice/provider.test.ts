import { afterEach, describe, expect, it, vi } from "vitest";
import { callMode, simulatedCall } from "./provider";

describe("calls", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("simulates outside production and never pretends in production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(callMode()).toBe("simulated");
    vi.stubEnv("NODE_ENV", "production");
    expect(callMode()).toBe("off");
    // A production build asked to simulate (the end-to-end tests).
    vi.stubEnv("SIMULATED_AGENT", "1");
    expect(callMode()).toBe("simulated");
    vi.stubEnv("SIMULATED_AGENT", "");
  });

  it("answers the same way for the same action, with every outcome possible", () => {
    expect(simulatedCall("a1", "Comcast", 16_500, 12_000)).toEqual(
      simulatedCall("a1", "Comcast", 16_500, 12_000),
    );
    const outcomes = new Set(
      Array.from(
        { length: 80 },
        (_, i) => simulatedCall(`a${i}`, "Comcast", 16_500, 12_000).outcome,
      ),
    );
    expect(outcomes).toEqual(new Set(["lowered", "offer", "refused", "needs_person"]));
    const offers = Array.from({ length: 80 }, (_, i) =>
      simulatedCall(`a${i}`, "Comcast", 16_500, 12_000),
    )
      .filter((c) => c.outcome === "offer")
      .map((c) => c.offerTerms?.contractMonths);
    // Some offers come with a contract, some without.
    expect(new Set(offers)).toEqual(new Set([12, 0]));
  });

  it("never lowers below the target, and says so on the call", () => {
    for (let i = 0; i < 40; i++) {
      const call = simulatedCall(`b${i}`, "Comcast", 16_500, 12_000);
      if (call.outcome === "lowered") {
        expect(call.newMonthlyCents).toBeGreaterThanOrEqual(12_000);
        expect(call.newMonthlyCents).toBeLessThan(16_500);
        expect(call.transcript).toContain("this call may be recorded");
      }
    }
  });
});
