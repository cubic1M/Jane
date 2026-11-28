import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { INVESTING_DETECTORS } from "./investing";
import { runDetectors } from "./index";

// Simplify pass, checked by the debugger 11-14: the over-50 catch-up card said "You can put in
// about $7,500.00 more a year", 2025's 401(k) catch-up. For 2026 it's $8,000 (IRS Rev. Proc.
// 2025-32, CONTRIBUTION_LIMITS.workplaceCatchUp50 in src/config/tax-rates.ts), and the card says
// what the table says.

describe("the over-50 catch-up card", () => {
  it("says this tax year's catch-up, $8,000", () => {
    const data = inputFor("preretire");
    const card = runDetectors({ profile: buildProfile(data), data }, INVESTING_DETECTORS).find(
      (s) => s.topic === "catch_up",
    );
    expect(card?.short).toBe("You can put in about $8,000.00 more a year.");
    expect(card?.why).toContain("put in about $8,000.00 more a year");
  });
});

// Tax T32c: the year's own catch-up, on either side of the new year (Notice 2025-67: $8,000 for 2026;
// Notice 2026-66: $8,500 for 2027), and the backdoor Roth card's IRA limit is the year's own too
// ($7,500 in 2026 and 2027; it was a fixed $7,000, the 2025 limit).
describe("the catch-up and IRA limits on either side of the new year", () => {
  const cards = (today: string) => {
    const base = inputFor("preretire");
    const data = { ...base, today };
    return runDetectors({ profile: buildProfile(data), data }, INVESTING_DETECTORS);
  };
  it("says 2026's $8,000 on December 31 2026 and 2027's $8,500 on January 2 2027", () => {
    expect(cards("2026-12-31").find((s) => s.topic === "catch_up")?.short).toBe(
      "You can put in about $8,000.00 more a year.",
    );
    expect(cards("2027-01-02").find((s) => s.topic === "catch_up")?.short).toBe(
      "You can put in about $8,500.00 more a year.",
    );
  });
  it("holds the card back for a year without IRS limits, never the last year's", () => {
    expect(cards("2028-01-02").find((s) => s.topic === "catch_up")).toBeUndefined();
  });
});
