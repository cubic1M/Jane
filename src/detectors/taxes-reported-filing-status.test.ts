import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { FILING_SINGLE_ASSUMPTION } from "@/planning/tax-profile";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (det-05, 10): a reported filing status beats the one guessed from the
// household, as it does on the unemployment card.
const figures = (filing?: string, household = "family") => {
  const base = inputFor("equity");
  const data: ProfileInput = {
    ...base,
    told: {
      ...base.told,
      household,
      has_children: true,
      ...(filing ? { filing_status: filing } : {}),
    },
  };
  return runDetectors({ profile: buildProfile(data), data }).filter(
    (s) => s.capability === "taxes",
  );
};
const worths = (filing?: string, household?: string) =>
  Object.fromEntries(figures(filing, household).map((s) => [s.topic, s.worthCents]));

describe("which return the tax cards work on", () => {
  it("is the one the person reported", () => {
    const joint = worths("married_joint");
    const single = worths("single");
    expect(JSON.stringify(single)).not.toEqual(JSON.stringify(joint));
  });
  // T8b: a family with no sign of a partner is priced as single (head of household is never
  // guessed), where it used to be priced as a joint return.
  it("falls back to a single return for a family with no sign of a partner", () => {
    expect(worths()).toEqual(worths("single"));
    expect(JSON.stringify(worths())).not.toEqual(JSON.stringify(worths("married_joint")));
  });
  it("falls back to a joint return when a partner is told", () => {
    expect(worths(undefined, "couple")).toEqual(worths("married_joint"));
  });
  it("takes head of household as its own, not a joint return", () => {
    expect(JSON.stringify(worths("head_of_household"))).not.toEqual(
      JSON.stringify(worths("married_joint")),
    );
  });
  // The cards priced by how they file say what they assumed, until the person says.
  it("says the single guess beside children on the cards it prices, and not once they answer", () => {
    const noted = figures().filter((s) => s.why.includes(FILING_SINGLE_ASSUMPTION));
    expect(noted.length).toBeGreaterThan(0);
    expect(figures("head_of_household").some((s) => s.why.includes(FILING_SINGLE_ASSUMPTION))).toBe(
      false,
    );
    expect(figures(undefined, "couple").some((s) => s.why.includes(FILING_SINGLE_ASSUMPTION))).toBe(
      false,
    );
  });
});
