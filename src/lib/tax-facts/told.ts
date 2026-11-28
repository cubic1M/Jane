import type { TaxFactKey } from "@/config/tax-facts";

// The facts a told answer writes to the household record (src/lib/tax-facts/legacy.ts
// factsFromTold), by the told fact's name in src/profile/facts.ts. Kept apart from the writers so
// the memory can ask the question without loading them.
export const KEYS_OF_TOLD: Readonly<Record<string, readonly TaxFactKey[]>> = {
  filing_status: ["filing.status"],
  claimed_as_dependent: ["filing.claimed_as_dependent"],
  tax_residency: ["residency.status"],
  enrollment: ["person.half_time", "person.degree_program"],
  age: ["person.birth_date"],
  home_state: ["home.state"],
  has_children: ["household.dependants_stated"],
};

// Whether a told fact of this name has anything to do with the tax record.
export const isTaxToldFact = (name: string) => name in KEYS_OF_TOLD;
