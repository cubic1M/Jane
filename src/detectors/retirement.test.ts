import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { MEDICARE, SOCIAL_SECURITY } from "@/config/retirement-taxes";
import { PERSON_IDS } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS } from "./index";

// Detector coverage: Medicare sign-up and Social Security timing reach Dan and Lena (near 65,
// still working) unasked, and nobody else.

const run = (topic: string, data: ProfileInput) =>
  DETECTORS.find((d) => d.topic === topic)!.detect({ profile: buildProfile(data), data });
const told = (id: string, t: ProfileInput["told"]) => inputFor(id, t);

describe("medicare", () => {
  it("reaches Dan and Lena with the Part B penalty for the two of them", () => {
    const s = run("medicare", inputFor("preretire"))!;
    // 10% of the 2026 premium, every month, for each of them, for each year late.
    expect(s.worthCents).toBe(Math.round(MEDICARE.partBMonthlyCents[2026] * 0.1 * 12 * 2));
    expect(s.worthKind).toBe("risk");
    expect(s.why).toMatch(/20 or more people, Part B can wait/);
    expect(s.urgency).toBe("later");
    // Their investor profile (spec step 129) tells Jane their age, so it's sure of it.
    expect(s.confidence.reason).not.toMatch(/don't know your age/);
    expect(s.confidence.percent).toBeGreaterThan(55);
  });

  it("is soon at 64, gone at 66, and never for anyone else", () => {
    expect(run("medicare", told("preretire", { age: 64 }))?.urgency).toBe("soon");
    expect(run("medicare", told("preretire", { age: 64 }))?.confidence.reason).not.toMatch(
      /don't know your age/,
    );
    expect(run("medicare", told("preretire", { age: 66 }))).toBeNull();
    for (const id of PERSON_IDS.filter((p) => p !== "preretire")) {
      expect(run("medicare", inputFor(id)), id).toBeNull();
    }
  });
});

describe("social_security_timing", () => {
  it("reaches Dan and Lena with the gain from waiting to 70, as an estimate", () => {
    const s = run("social_security_timing", inputFor("preretire"))!;
    expect(s.worthKind).toBe("earns");
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.why).toMatch(/Social Security statement/);
    expect(s.confidence.reason).toMatch(/estimated from your pay|don't know your age/);
    expect(s.title).toContain(
      `at ${SOCIAL_SECURITY.latestAge} instead of ${SOCIAL_SECURITY.fullAge}`,
    );
  });

  it("isn't for someone already claiming, or anyone else", () => {
    // Ruth already gets Social Security.
    expect(run("social_security_timing", inputFor("retiree"))).toBeNull();
    for (const id of PERSON_IDS.filter((p) => p !== "preretire")) {
      expect(run("social_security_timing", inputFor(id)), id).toBeNull();
    }
    expect(run("social_security_timing", told("preretire", { age: 70 }))).toBeNull();
    expect(run("social_security_timing", told("preretire", { age: 62 }))?.urgency).toBe("soon");
  });
});

describe("cash_flow", () => {
  it("reaches Jo with a weekly set-aside for her quarterly sales tax", () => {
    const s = run("cash_flow", inputFor("owner"))!;
    expect(s.short).toMatch(/every 3 months/);
    expect(s.title).toMatch(/from each week's sales/);
    expect(s.confidence.reason).toMatch(/tax payments/);
    expect(s.action.href).toBe("/taxes/business");
  });

  it("needs a business, and at least two lumps", () => {
    for (const id of PERSON_IDS.filter((p) => p !== "owner")) {
      expect(run("cash_flow", inputFor(id)), id).toBeNull();
    }
    const jo = inputFor("owner");
    const one = {
      ...jo,
      transactions: jo.transactions.filter(
        (t, i, all) =>
          !/SALES TAX/i.test(t.description) ||
          all.findIndex((x) => /SALES TAX/i.test(x.description)) === i,
      ),
    };
    expect(run("cash_flow", one)).toBeNull();
  });
});
