import { describe, expect, it } from "vitest";
import { ITEMIZED } from "@/config/tax-rates";
import { figuresOf, homeTaxes, saltCap, type HomeInput } from "./home-taxes";

// Spec step 170: the state and local tax cap is applied, and every figure links to its
// transactions, documents or answers.

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
  it("applies the state and local tax cap to income and property tax together", () => {
    const t = homeTaxes(base({ stateIncomeTaxCents: 3_500_000 }));
    expect(t.salt.totalCents).toBe(3_500_000 + 1_200_000);
    expect(t.salt.capCents).toBe(ITEMIZED.saltCap.normal);
    expect(t.salt.allowedCents).toBe(ITEMIZED.saltCap.normal);
    expect(t.salt.overCents).toBe(4_700_000 - ITEMIZED.saltCap.normal);
    // Under the cap, all of it counts.
    expect(homeTaxes(base()).salt).toMatchObject({ allowedCents: 2_700_000, overCents: 0 });
  });

  it("shrinks the cap above the phase-down income, never below the floor", () => {
    expect(saltCap(ITEMIZED.saltPhaseDownFrom.normal, "single")).toBe(ITEMIZED.saltCap.normal);
    expect(saltCap(ITEMIZED.saltPhaseDownFrom.normal + 1_000_000, "single")).toBe(
      ITEMIZED.saltCap.normal - 300_000,
    );
    expect(saltCap(100_000_000, "single")).toBe(ITEMIZED.saltFloor.normal);
    expect(saltCap(0, "married_separate")).toBe(ITEMIZED.saltCap.marriedSeparate);
  });

  it("counts mortgage interest on the debt limit's share, preferring the 1098", () => {
    const big = homeTaxes(
      base({
        mortgage: {
          name: "Home Loan",
          ytdInterestCents: 3_000_000,
          balanceCents: 100_000_000,
          form1098: null,
        },
      }),
    );
    expect(big.mortgageInterest!.cents).toBe(2_250_000);
    expect(big.mortgageInterest!.note).toBe(
      "Only the interest on the first $750,000 of the loan counts.",
    );
    const withForm = homeTaxes(
      base({
        mortgage: {
          name: "Home Loan",
          ytdInterestCents: 1_500_000,
          balanceCents: 40_000_000,
          form1098: { key: "mortgage:home-loan", from: "Home Loan", cents: 1_800_000, points: 0 },
        },
      }),
    );
    expect(withForm.mortgageInterest!.sources).toEqual([
      {
        kind: "document",
        key: "mortgage:home-loan",
        form: "1098",
        from: "Home Loan",
        cents: 1_800_000,
      },
    ]);
  });

  it("deducts points on a purchase at once, a refinance's over the loan", () => {
    expect(
      homeTaxes(base({ points: { cents: 600_000, purchase: true, loanYears: 30 } })).points!.cents,
    ).toBe(600_000);
    expect(
      homeTaxes(base({ points: { cents: 600_000, purchase: false, loanYears: 30 } })).points!.cents,
    ).toBe(20_000);
  });

  it("gives energy credits only for work done by the end date", () => {
    const t = homeTaxes(
      base({
        energy: [
          { id: "e1", date: "2025-09-01", payee: "SUNRUN SOLAR", cents: 2_000_000, uncapped: true },
          {
            id: "e2",
            date: "2025-10-01",
            payee: "ACME INSULATION",
            cents: 1_000_000,
            uncapped: false,
          },
          {
            id: "e3",
            date: "2026-03-01",
            payee: "ACME INSULATION",
            cents: 1_000_000,
            uncapped: false,
          },
        ],
      }),
    );
    expect(t.energy.map((e) => e.cents)).toEqual([600_000, 120_000, 0]);
    expect(t.energy[2].note).toBe("Home energy credits ended for work after 2025-12-31.");
  });

  it("tracks a sale's gain against the exclusion, with the rules", () => {
    const sale = {
      boughtOn: "2019-06-01",
      priceCents: 40_000_000,
      soldOn: "2026-08-01",
      saleCents: 100_000_000,
      costsCents: 5_000_000,
      improvements: [{ id: "i1", date: "2021-05-01", payee: "ROOFING CO", cents: 2_000_000 }],
      daysLivedIn: 1_500,
    };
    const ok = homeTaxes(base({ sale })).sale!;
    expect(ok.basis.cents).toBe(42_000_000);
    expect(ok.gainCents).toBe(100_000_000 - 5_000_000 - 42_000_000);
    expect(ok).toMatchObject({
      qualifies: true,
      exclusionCents: 50_000_000,
      taxableGainCents: 3_000_000,
    });
    const single = homeTaxes(base({ status: "single", sale })).sale!;
    expect(single.exclusionCents).toBe(25_000_000);
    const short = homeTaxes(
      base({ sale: { ...sale, boughtOn: "2025-06-01", daysLivedIn: 300 } }),
    ).sale!;
    expect(short.qualifies).toBe(false);
    expect(short.why).toHaveLength(2);
    expect(short.taxableGainCents).toBe(short.gainCents);
  });

  it("links every figure to where it came from", () => {
    const t = homeTaxes(
      base({
        points: { cents: 300_000, purchase: true, loanYears: 30 },
        homeOfficeSqFt: 150,
        energy: [{ id: "e1", date: "2025-09-01", payee: "SUNRUN", cents: 100_000, uncapped: true }],
        sale: {
          boughtOn: "2019-06-01",
          priceCents: 40_000_000,
          soldOn: "2026-08-01",
          saleCents: 60_000_000,
          costsCents: 0,
          improvements: [],
          daysLivedIn: 1_000,
        },
      }),
    );
    const figures = figuresOf(t);
    expect(figures).toHaveLength(8);
    for (const f of figures) expect(f.sources.length, f.label).toBeGreaterThan(0);
    expect(t.propertyTax!.sources.map((s) => (s.kind === "transaction" ? s.id : null))).toEqual([
      "t1",
      "t2",
    ]);
  });
});
