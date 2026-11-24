import { describe, expect, it } from "vitest";
import { stateParts } from "./tax-states";

// CodeRabbit sweep 1b: a person who moved from New Jersey to New York City in July and works
// for a New York employer all year had New York State tax on the whole year (remote wages
// while in New Jersey) and the city's resident tax was then applied to the whole year too.
const who = { filingStatus: "single" as const, childrenUnder17: 0, otherDependants: 0 };
const run = (workState: string | null) =>
  stateParts({
    year: 2026,
    state: "NY",
    residency: {
      moves: [{ date: "2026-07-01", from: "NJ", to: "NY" } as never],
      workState,
      locality: "nyc",
      paydays: [],
    },
    who,
    agiCents: 12_000_000,
    wagesCents: 12_000_000,
  });

describe("city resident tax for a part-year city resident", () => {
  it("does not grow when the employer's state taxes the remote wages", () => {
    const without = run(null).local!;
    const withWork = run("NY").local!;
    expect(withWork.taxCents).toBe(without.taxCents);
  });
});
