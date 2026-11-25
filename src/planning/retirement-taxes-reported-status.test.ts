import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { readRetirementTaxes } from "./retirement-taxes-read";

// CodeRabbit sweep 1c (PR #2268): the retirement reader took the filing status from the household
// alone, while every other tax figure uses the one the person reported (filingStatusOf). A retiree
// who says they file jointly with no second earner in the data got single brackets on the next
// dollar of pre-tax money, and a rate the Roth card then kept as the higher of the two.
const read = (told: Parameters<typeof inputFor>[1]) => {
  const data = inputFor("retiree", told);
  return readRetirementTaxes(buildProfile(data), data);
};

describe("the retirement reader's filing status", () => {
  it("is the one the person reported, not the household's", () => {
    const base = read({});
    expect(base.status).toBe("single");
    const told = read({ filing_status: "married_joint" });
    expect(told.status).toBe("married_joint");
    expect(told.people).toBe(2);
  });

  it("reads a reported single as single and keeps joint brackets apart from single ones", () => {
    const single = read({ filing_status: "single" });
    const joint = read({ filing_status: "married_joint" });
    expect(single.status).toBe("single");
    expect(joint.nextDollarRate).toBeLessThanOrEqual(single.nextDollarRate);
  });

  it("falls back to the household when no status was reported", () => {
    expect(read({}).status).toBe(read({ filing_status: "single" }).status);
  });

  it("files head of household and married separately as single, the reader's only other case", () => {
    expect(read({ filing_status: "head_of_household" }).status).toBe("single");
    expect(read({ filing_status: "married_separate" }).status).toBe("single");
  });
});
