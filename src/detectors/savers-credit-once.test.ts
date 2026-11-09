import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SAVERS_CREDIT_DETECTORS } from "./savers-credit";

// Debugger 11-09 (demo walk): someone on low pay saw "Check the Saver's Credit, earn $200/yr".
// 2026 is the credit's last year, so it's worth its amount once; the Saver's Match after it
// is the one that comes every year.

const run = (topic: string) => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    today: "2026-11-09",
    told: { ...base.told, monthly_income: 120_000, filing_status: "single" },
  };
  return runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS).find(
    (s) => s.topic === topic,
  )!;
};

describe("what the Saver's cards are worth", () => {
  it("says the Saver's Credit, in its last year, comes once", () => {
    const s = run("savers_credit");
    expect(s.headline).toBe("Check the Saver's Credit, get $200 back");
    expect(s.headline).not.toMatch(/a year/);
  });

  it("says the Saver's Match, from 2027 on, comes every year", () => {
    expect(run("savers_match").headline).toBe("Check the 2027 Saver's Match, earn $1,000 a year");
  });
});
