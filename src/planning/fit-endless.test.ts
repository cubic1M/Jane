import { describe, expect, it } from "vitest";
import { fit, keepCost } from "./fit";

// CodeRabbit sweep 1b: a baseline whose payment doesn't cover its interest never pays off; it was
// shown as "for 120 more months" like a real payoff.
describe("keeping a debt the payment never pays off", () => {
  const baseline = {
    label: "the card",
    balanceCents: 1_000_000,
    aprBps: 2_999,
    monthlyCents: 20_000, // under a month's interest (about $250)
  };
  it("is marked endless", () => {
    expect(keepCost(baseline).endless).toBe(true);
    expect(keepCost({ ...baseline, monthlyCents: 60_000 }).endless).toBe(false);
  });
  it("a payoff that takes 121 months is a real payoff, with its full cost", () => {
    const k = keepCost({ label: "c", balanceCents: 121_000, aprBps: 0, monthlyCents: 1_000 });
    expect(k).toEqual({ months: 121, totalCents: 121_000, endless: false });
  });
  it("says 'at least' and not a payoff date in the option's details", () => {
    const r = fit({
      need: "personal",
      product: "personal",
      amountCents: 1_000_000,
      person: {
        creditScore: 720,
        incomeCents: 600_000,
        debtPaymentsCents: 20_000,
        cashCents: 100_000,
        debtTrouble: false,
      },
      offers: [
        {
          id: "L",
          lender: "L",
          product: "personal",
          aprBps: 900,
          rateType: "fixed",
          termMonths: 48,
          feeCents: 0,
          feeLabel: "",
          sourceUrl: "https://example.com",
          demo: true,
        },
      ],
      baseline,
    });
    const text = r.options.flatMap((o) => o.details).join("\n");
    expect(text).toMatch(/At least \$.* less than keeping the card/);
    expect(text).not.toMatch(/for 120 more months/);
    expect(r.options.map((o) => o.headline).join("\n")).not.toMatch(/for 10 yrs more/);
  });
});

describe("the keep option of a debt that is never paid off", () => {
  it("carries the endless flag for the card to say 'at least'", async () => {
    const { fit } = await import("./fit");
    const r = fit({
      need: "personal",
      product: "personal",
      amountCents: 1_000_000,
      person: {
        creditScore: 720,
        incomeCents: 600_000,
        debtPaymentsCents: 20_000,
        cashCents: 100_000,
        debtTrouble: false,
      },
      offers: [
        {
          id: "L",
          lender: "L",
          product: "personal",
          aprBps: 900,
          rateType: "fixed",
          termMonths: 48,
          feeCents: 0,
          feeLabel: "",
          sourceUrl: "https://example.com",
          demo: true,
        },
      ],
      baseline: { label: "the card", balanceCents: 1_000_000, aprBps: 2_999, monthlyCents: 20_000 },
    });
    const keep = r.options.find((o) => o.label === "keep");
    expect(keep?.endless).toBe(true);
  });
});
