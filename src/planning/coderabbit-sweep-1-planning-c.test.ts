import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { readHealthTaxes } from "./health-taxes-read";
import { homeTaxes, type HomeInput } from "./home-taxes";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 4: each case is a finding
// reproduced against the code first (failing), then fixed.

const base = (over: Partial<HomeInput> = {}): HomeInput => ({
  year: 2026,
  status: "married_joint",
  agiCents: 20_000_000,
  mortgage: {
    name: "Home Loan",
    ytdInterestCents: 1_800_000,
    balanceCents: 50_000_000,
    form1098: null,
  },
  propertyTax: [
    { id: "t1", date: "2026-04-10", payee: "COUNTY TAX COLLECTOR", cents: 600_000 },
    { id: "t2", date: "2026-11-10", payee: "COUNTY TAX COLLECTOR", cents: 600_000 },
  ],
  stateIncomeTaxCents: 1_500_000,
  points: null,
  homeOfficeSqFt: null,
  energy: [],
  sale: null,
  ...over,
});

describe("homeowner taxes", () => {
  it("applies the home energy improvement cap to the year, not to each purchase", () => {
    const t = homeTaxes(
      base({
        energy: [
          {
            id: "e1",
            date: "2025-03-01",
            payee: "ACME INSULATION",
            cents: 1_000_000,
            uncapped: false,
          },
          {
            id: "e2",
            date: "2025-09-01",
            payee: "ACME WINDOWS",
            cents: 1_000_000,
            uncapped: false,
          },
          { id: "e3", date: "2025-10-01", payee: "SUNRUN SOLAR", cents: 1_000_000, uncapped: true },
        ],
      }),
    );
    // $1,200 for the year across the two capped purchases; solar is not capped.
    expect(t.energy.map((e) => e.cents)).toEqual([120_000, 0, 300_000]);
  });
});

describe("health taxes", () => {
  it("does not read Facebook Marketplace charges as a health plan's premiums", () => {
    const d = inputFor("renter");
    const year = d.today.slice(0, 4);
    const shop = ["01", "02", "03", "04"].map((m) => ({
      date: `${year}-${m}-05`,
      amountCents: 25_000,
      description: "FACEBOOK MARKETPLACE PURCHASE",
      pfc: "GENERAL_MERCHANDISE_OTHER",
      accountId: d.accounts[0]!.id,
    }));
    const h = readHealthTaxes(buildProfile({ ...d, transactions: [...d.transactions, ...shop] }), {
      ...d,
      transactions: [...d.transactions, ...shop],
    });
    expect(h.marketplace.payments).toBe(0);
    expect(h.marketplace.check).toBeNull();
  });
});
