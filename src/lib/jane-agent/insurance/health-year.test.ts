import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { fsaStatus, progress } from "@/lib/insurance/health-year-rules";
import { normalize } from "../intents";
import { healthYearLines } from "./health-year";
import { parseInsurance } from "./intents";

// Spec step 200: asking where they are in their health plan's year, and the answer's facts.

describe("health year questions", () => {
  it.each(["is my doctor in network", "was this medical bill right"])("reads %s", (text) => {
    expect(parseInsurance(normalize(text))?.ask).toBe("health_year");
  });

  // The direct questions get a short answer (./decisions.ts).
  it.each([
    "how much of my deductible have I met",
    "when will I hit my out of pocket max",
    "how much is left in my FSA",
    "have I met my deductible this year",
  ])("answers %s directly", (text) => {
    expect(parseInsurance(normalize(text))?.ask).toBe("decide");
  });
});

describe("healthYearLines", () => {
  const plan = {
    label: "Acme PPO (sample plan)",
    deductibleCents: 150_000,
    outOfPocketMaxCents: 450_000,
    coinsurance: 20,
  };
  const bills = [{ id: "a", date: "2026-03-01", provider: "CVS", cents: 40_000, category: null }];

  it("says the deductible, the maximum, the FSA deadline and a sample plan", () => {
    const text = healthYearLines({
      plan,
      sample: true,
      progress: progress(plan, bills, "2026-10-19"),
      bills: bills.map((b) => ({ ...b, network: "in" as const })),
      fsa: fsaStatus(240_000, 100_000, "2026-10-19"),
      hsa: { name: "Demo HSA", balanceCents: 427_180 },
      disputes: [],
    }).join("\n");
    expect(text).toMatch(/met \$400\.00 of your \$1,500\.00 deductible/);
    expect(text).toMatch(/won't reach it this year/);
    expect(text).toMatch(/\$1,400\.00 is left in your FSA.*Dec 31/);
    expect(text).toMatch(/Demo HSA holds \$4,271\.80/);
    expect(text).toMatch(/sample plan/);
  });
});
