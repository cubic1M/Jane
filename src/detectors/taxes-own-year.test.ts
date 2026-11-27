import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { PERSON_IDS } from "@/config/people";
import { runDetectors } from "./index";
import { TAX_DETECTORS } from "./taxes";

// Tax T32c: the tax cards read the figures of the year of the person's own day, never a frozen 2026:
// the year-end 401(k) card names that year's limit (Notice 2025-67: $24,500 in 2026; Notice 2026-66:
// $25,500 in 2027), and a year with no IRS figures holds the card back.
const yearEnd = (id: string, today: string) => {
  const base = inputFor(id);
  const data: ProfileInput = { ...base, today };
  return runDetectors({ profile: buildProfile(data), data }, TAX_DETECTORS).find(
    (s) => s.topic === "year_end_moves",
  );
};
const person = PERSON_IDS.find((id) => yearEnd(id, "2026-12-31") !== undefined);

describe("the year-end 401(k) card", () => {
  it("has a sample person it shows for", () => {
    expect(person).toBeDefined();
  });
  it("names the year's own limit on December 31 2026 and on December 31 2027", () => {
    expect(yearEnd(person!, "2026-12-31")?.confidence.reason).toContain("the $24,500.00 limit");
    expect(yearEnd(person!, "2027-12-31")?.confidence.reason).toContain("the $25,500.00 limit");
  });
  it("is held back for a year without IRS figures, never priced with the last year's limit", () => {
    expect(yearEnd(person!, "2028-12-31")).toBeUndefined();
  });
});

// The estimated-tax card is for a tax year: with no IRS figures for it the card is not said.
describe("the estimated taxes card", () => {
  const card = (today: string) => {
    const base = inputFor("freelancer");
    const data: ProfileInput = { ...base, today };
    return runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "estimated_taxes",
    );
  };
  it("is said for 2026 and held back for 2028, which has no IRS figures", () => {
    expect(card("2026-12-15")).toBeDefined();
    expect(card("2028-06-01")).toBeUndefined();
  });
});
