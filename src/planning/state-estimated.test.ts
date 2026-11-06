import { describe, expect, it } from "vitest";
import { STATE_ESTIMATED_TAX } from "@/config/state-estimated-tax";
import { STATE_SOURCES } from "@/config/tax-states";
import { stateEstimated } from "./state-estimated";

// Connectors roadmap round 16: where each state's estimated tax is paid, and when.

const site = (url: string) => new URL(url).hostname.split(".").slice(-2).join(".");

describe("the state link table", () => {
  it("splits each year into 100%, and links only to the state's own site over https", () => {
    for (const [state, row] of Object.entries(STATE_ESTIMATED_TAX)) {
      expect(
        row.shares.reduce((a, b) => a + b, 0),
        state,
      ).toBe(100);
      expect(row.url.startsWith("https://"), state).toBe(true);
      expect(site(row.url), state).toBe(site(STATE_SOURCES[state]!.url));
    }
  });

  it("knows New York needs a login for estimated tax, and North Carolina is unconfirmed", () => {
    expect(STATE_ESTIMATED_TAX.NY!.guest).toBe(false);
    expect(STATE_ESTIMATED_TAX.NC!.guest).toBeNull();
    expect(STATE_ESTIMATED_TAX.NJ!.asks).toEqual(["SSN", "date of birth"]);
  });
});

describe("stateEstimated", () => {
  it("gives California no September payment: 30%, 40%, then 30% in January", () => {
    const ca = stateEstimated("ca", 1_000_001, 2026);
    if (!("payments" in ca)) throw new Error("expected payments");
    expect(ca.payments).toEqual([
      { due: "2026-04-15", cents: 300_000, percent: 30 },
      { due: "2026-06-15", cents: 400_000, percent: 40 },
      { due: "2027-01-15", cents: 300_001, percent: 30 },
    ]);
    expect(ca.payments.some((p) => p.due.endsWith("-09-15"))).toBe(false);
  });

  it("splits a state on the federal pattern in four, the cents adding up", () => {
    const ga = stateEstimated("GA", 100_003, 2026);
    if (!("payments" in ga)) throw new Error("expected payments");
    expect(ga.payments.map((p) => p.due)).toEqual([
      "2026-04-15",
      "2026-06-15",
      "2026-09-15",
      "2027-01-15",
    ]);
    expect(ga.payments.reduce((s, p) => s + p.cents, 0)).toBe(100_003);
    expect(ga.where.guest).toBe(true);
  });

  it("has nothing for a state with no income tax, and says when a state isn't listed", () => {
    expect(stateEstimated("TX", 50_000, 2026)).toEqual({ state: "TX", none: "no_income_tax" });
    expect(stateEstimated("FL", 50_000, 2026)).toEqual({ state: "FL", none: "no_income_tax" });
    expect(stateEstimated("OR", 50_000, 2026)).toEqual({ state: "OR", none: "not_listed" });
  });
});
