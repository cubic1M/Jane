import { describe, expect, it } from "vitest";
import { CHECKING, input } from "@/detection/__fixtures__/build";
import { safeToSpend } from "@/planning/safe-to-spend";
import { heroView } from "./view";

// Pre-deploy walk 11-27 (debug 2, part 4): in a year with no IRS figures Safe to spend said "Not
// counted: tax, as Jane can't see all that's withheld from your pay", which is not the reason. It
// says the no-figures sentence for the year, and keeps the old reason for the old case.
const lines = (noParamsYear?: number) => {
  const safe = safeToSpend(
    input({ asOf: "2028-02-10", accounts: [{ ...CHECKING, currentBalanceCents: 500_000 }] }),
    {
      budgetsLeftCents: 0,
      goalsCents: 0,
      tax: {
        holdCents: 0,
        status: "unknown",
        keptApartCents: 0,
        confidencePercent: 0,
        ...(noParamsYear ? { noParamsYear } : {}),
      },
    },
  );
  const hero = heroView({
    asOf: "2028-02-10",
    safe,
    netWorth: null,
    foundCents: 0,
    savedCents: 0,
  });
  return JSON.stringify(hero);
};

describe("the tax line of Safe to spend when the year has no IRS figures", () => {
  it("says the sentence for that year", () => {
    expect(lines(2028)).toContain("Jane doesn't have the IRS figures for 2028 yet");
    expect(lines(2028)).not.toContain("can't see all that's withheld");
  });
  it("keeps the withholding reason when the figures exist but the withholding is unknown", () => {
    expect(lines()).toContain("can't see all that's withheld");
  });
});
