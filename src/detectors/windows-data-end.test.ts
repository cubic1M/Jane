import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { fitPersonFrom } from "@/planning/fit-person";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor, SAMPLE_TODAY } from "@/profile/sample";
import { DETECTORS } from "./index";

// Gate C's calendar sweep, 11-16: with a bank that hadn't synced for weeks, two windows still
// counted back from today. Card interest's year lost a charge every month ("10 interest charges
// in 12 months" became 9), and the three months of loan payments a lender counts lost one on
// each 1st, so what the freelancer could borrow went up by itself. Both now end where the data
// does, as the pace and the report already did.

// The sample's data ends the day before SAMPLE_TODAY. Read when it's past STALE_AFTER_DAYS (from
// then on it ends where the statements do) and again two months on.
const STALE = "2026-12-01";
const LATER = "2027-02-01";
const at = (id: Parameters<typeof inputFor>[0], today: string): ProfileInput => ({
  ...inputFor(id),
  today,
});

describe("windows when the data stopped coming in", () => {
  it("count the same card interest charges months later", () => {
    const card = DETECTORS.find((d) => d.topic === "card_interest")!;
    const read = (today: string) => {
      const data = at("renter", today);
      return card.detect({ profile: buildProfile(data), data })?.confidence;
    };
    const stale = read(STALE);
    expect(stale?.reason).toMatch(/^\d+ interest charges/);
    expect(read(SAMPLE_TODAY)).toEqual(stale);
    expect(read(LATER)).toEqual(stale);
  });

  it("count the same loan payments for what a lender would lend months later", () => {
    const paid = (today: string) => fitPersonFrom(at("freelancer", today)).debtPaymentsCents;
    expect(paid(STALE)).toBeGreaterThan(0);
    expect(paid(LATER)).toBe(paid(STALE));
  });
});
