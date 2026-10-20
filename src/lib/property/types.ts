import type { Comparable } from "@/planning/property-tax";

// What a property data partner gives for a home: the county's assessment, an estimate of
// market value and recent comparable sales. The stand-in is src/lib/property/demo.ts; a real
// partner (an assessor feed and a sales-data provider) plugs in behind this.
export type PropertyRecord = {
  address: string;
  assessedCents: number;
  assessedYear: number;
  marketCents: number;
  comps: Comparable[];
};

export interface PropertyPartner {
  name: string;
  lookup(input: { mortgageBalanceCents: number | null; today: string }): PropertyRecord | null;
}
