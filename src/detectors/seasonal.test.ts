import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PERSON_IDS, type PersonId } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS } from "./index";

// Detector coverage: the tax detectors that fit none of the sample people on the harness's day
// (October) because they belong to a season. On their own dates they reach the people they fit,
// and out of season they stay quiet.

const on = (id: PersonId, today: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change({ ...inputFor(id), today });
  return DETECTORS.filter((d) => d.capability === "taxes").flatMap((d) => {
    const s = d.detect({ profile: buildProfile(data), data });
    return s ? [s.topic as string] : [];
  });
};
const who = (topic: string, today: string) =>
  PERSON_IDS.filter((id) => on(id, today).includes(topic));
const OCTOBER = inputFor("renter").today;

describe("filing season (January 15 to April 15)", () => {
  it("brings everyone with a known income their return to file, until it's filed", () => {
    expect(who("file_return", "2027-02-16")).toEqual([...PERSON_IDS]);
    // A refund this year means it's filed.
    const refunded = on("renter", "2027-03-10", (d) => ({
      ...d,
      transactions: [
        ...d.transactions,
        {
          date: "2027-03-01",
          amountCents: -84_000,
          description: "IRS TREAS 310 TAX REF",
          pfc: "INCOME_TAX_REFUND",
          accountId: d.accounts[0].id,
        },
      ],
    }));
    expect(refunded).not.toContain("file_return");
    expect(who("file_return", OCTOBER)).toEqual([]);
    expect(who("file_return", "2027-04-20")).toEqual([]);
  });
});

describe("the IP PIN season (January 1 to April 15)", () => {
  it("brings everyone the free Identity Protection PIN before they file", () => {
    expect(who("identity_ip_pin", "2027-01-05")).toEqual([...PERSON_IDS]);
    expect(who("identity_ip_pin", OCTOBER)).toEqual([]);
  });
});

describe("year-end moves (from November 15)", () => {
  it("brings the people with a workplace plan their last chance to put more in", () => {
    const people = who("year_end_moves", "2026-12-01");
    expect(people.length).toBeGreaterThan(0);
    // Not someone in debt trouble, and nobody before the season.
    expect(people).not.toContain("debt");
    expect(who("year_end_moves", OCTOBER)).toEqual([]);
  });
});

describe("the draft return check (filing season, once a draft is uploaded)", () => {
  it("brings Sam the 1099 his draft left out, before he files", () => {
    const draft = (d: ProfileInput): ProfileInput => ({
      ...d,
      extras: {
        householdMembers: 0,
        ...d.extras,
        draftReturn: {
          year: 2026,
          findings: [
            {
              key: "1099-nec:northwind",
              kind: "income_missing",
              title: "Your Northwind Studio 1099-NEC isn't on the draft",
              line: "Schedule C, line 1",
              draftCents: 4_200_000,
              knownCents: 5_600_000,
              effect: "owes",
              dollarsCents: 420_000,
              why: "Northwind Studio paid you $14,000.00 this year; the draft's gross receipts leave it out.",
            },
          ],
        },
      },
    });
    expect(on("freelancer", "2027-03-02", draft)).toContain("draft_return_check");
    // Without an uploaded draft there is nothing to check.
    expect(who("draft_return_check", "2027-03-02")).toEqual([]);
  });
});
