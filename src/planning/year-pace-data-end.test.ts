import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { readHealthTaxes } from "./health-taxes-read";
import { readRetirementTaxes } from "./retirement-taxes-read";

// Gate C's calendar sweep, 11-16: with a bank that hadn't synced for weeks, this year's pace
// counted every month up to today as a month seen, and the retiree's year counted back from
// today. So on Dec 1, with no new data, the freelancer's income "on pace for" fell by $9,500,
// the HSA's "by December" by $450, and the taxable part of the retiree's Social Security by
// $1,500. Both now go by where the data ends.

// The sample's data ends Oct 16; both days are past STALE_AFTER_DAYS, in the same year.
const NOVEMBER = "2026-11-25";
const DECEMBER = "2026-12-30";
const at = (id: Parameters<typeof inputFor>[0], today: string) => {
  const data: ProfileInput = { ...inputFor(id), today };
  return { profile: buildProfile(data), data };
};

describe("this year's pace when the data stopped coming in", () => {
  it("projects the same income for the freelancer a month later", () => {
    const pace = (today: string) => {
      const { profile, data } = at("freelancer", today);
      return readHealthTaxes(profile, data).pace.projectedCents;
    };
    expect(pace(NOVEMBER)).toBeGreaterThan(0);
    expect(pace(DECEMBER)).toBe(pace(NOVEMBER));
  });

  it("projects the same HSA deposits a month later", () => {
    const hsa = (today: string) => {
      const { profile, data } = at("equity", today);
      return readHealthTaxes(profile, data).hsa.projectedCents;
    };
    expect(hsa(NOVEMBER)).toBeGreaterThan(0);
    expect(hsa(DECEMBER)).toBe(hsa(NOVEMBER));
  });

  it("counts the same year of the retiree's income a month later", () => {
    const year = (today: string) => {
      const { profile, data } = at("retiree", today);
      const r = readRetirementTaxes(profile, data);
      return [r.ssBenefitsCents, r.otherIncomeCents, r.ss.taxableCents];
    };
    expect(year(NOVEMBER)[0]).toBeGreaterThan(0);
    expect(year(DECEMBER)).toEqual(year(NOVEMBER));
  });
});
