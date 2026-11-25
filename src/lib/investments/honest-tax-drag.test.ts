import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { FUND_FACTS, REAL_FUND_FACTS } from "@/config/funds";
import { taxOnPayoutsCents } from "./honest";

// CodeRabbit sweep 1b: a real holding with the ticker of a demo fund was given the demo fund's
// made-up yield in the tax-on-payouts figure.
const held = [{ taxable: true, ticker: "PDIFX", valueCents: 10_000_000 }];
const rates = { ordinaryRate: 0.24, gainRate: 0.15 };

describe("tax on payouts", () => {
  it("uses the demo fund's yield only for a demo account", () => {
    expect(taxOnPayoutsCents(held, rates, FUND_FACTS)).toBeGreaterThan(0);
  });
  it("gives a real account nothing from a fund it has no real facts for", () => {
    expect(REAL_FUND_FACTS.PDIFX).toBeUndefined();
    expect(taxOnPayoutsCents(held, rates, REAL_FUND_FACTS)).toBe(0);
  });
});
