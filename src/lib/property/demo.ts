import { DEMO_HOME } from "@/config/property-tax";
import type { PropertyPartner } from "./types";

// The stand-in for a county assessor feed and a sales-data provider, for the demo bank's
// sample home: worth its mortgage balance over the loan-to-value, assessed above that, with
// three sales around the value. Sample data; deterministic.
const OFFSETS = [
  { street: "214 Maple Court", sqft: 1_780, delta: -0.03, daysAgo: 52 },
  { street: "9 Orchard Lane", sqft: 1_920, delta: 0.02, daysAgo: 118 },
  { street: "47 Juniper Way", sqft: 1_850, delta: -0.01, daysAgo: 201 },
];

const dayBefore = (today: string, days: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

export const demoPropertyPartner: PropertyPartner = {
  name: "demo",
  lookup({ mortgageBalanceCents, today }) {
    if (mortgageBalanceCents === null || mortgageBalanceCents <= 0) return null;
    const marketCents = Math.round(mortgageBalanceCents / DEMO_HOME.loanToValue);
    const perSqft = marketCents / DEMO_HOME.squareFeet;
    return {
      address: "Your home (sample address)",
      assessedCents: Math.round(marketCents * DEMO_HOME.overAssessedBy),
      assessedYear: Number(today.slice(0, 4)),
      marketCents,
      comps: OFFSETS.map((o) => {
        const priceCents = Math.round(o.sqft * perSqft * (1 + o.delta));
        return {
          address: `${o.street} (sample sale)`,
          soldOn: dayBefore(today, o.daysAgo),
          priceCents,
          squareFeet: o.sqft,
          adjustedCents: Math.round((priceCents / o.sqft) * DEMO_HOME.squareFeet),
        };
      }),
    };
  },
};
