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
