import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1b follow-up (#2256 gave readHealthTaxes coverageAssumed and selfLimitCents):
// a married filer is read as family cover, so deposits over the self-only limit but within the
// family one were never flagged. They are now a conditional card: over only with self-only cover.
const card = (household?: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const base = inputFor("equity");
  const data = change(
    household ? { ...base, told: { ...base.told, household: household as never } } : base,
  );
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "hsa_over_limit",
  );
};

describe("HSA deposits over the self-only limit, cover not told", () => {
  it("names both limits for a married filer, with no penalty figure", () => {
    const s = card("couple")!;
    expect(s).toBeDefined();
    expect(s.worthCents).toBe(0);
    expect(s.title).toMatch(/self-only limit/);
    expect(s.why).toMatch(/With family cover the limit is \$8,\d{3}\.00, so that fits/);
    expect(s.why).toMatch(/self-only cover it is \$4,400\.00/);
  });
  it("keeps the penalty card for a single filer", () => {
    const s = card()!;
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.title).toMatch(/over this year's limit/);
  });
  it("is quiet for a married filer under the self-only limit", () => {
    const s = card("couple", (d) => ({
      ...d,
      transactions: d.transactions.filter((t) => !/HSA/i.test(t.description)),
    }));
    expect(s).toBeUndefined();
  });
});
