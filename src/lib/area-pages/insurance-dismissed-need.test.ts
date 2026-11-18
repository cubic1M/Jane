import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";

// Debug 2, sixth desktop sweep (11-18, upload S3): after "I don't need it" on "No disability
// insurance on file.", Insurance's perfect coverage still listed "Disability cover, $1.1k/mo short.
// You need $1.1k/mo; you have $0/mo." as needing a look. What the person said they don't need
// isn't listed short.

const disability = {
  kind: "disability",
  policyId: null,
  gapCents: 110_000,
  haveCents: 0,
  needCents: 110_000,
  unit: "per_month" as const,
  summary: "",
  opened: false,
};

const input = (dismissed: string[]): InsuranceTreeInput =>
  ({
    asOf: "2026-11-18",
    needs: [disability],
    policies: [],
    gaps: [],
    savings: [],
    renewals: [],
    changes: [],
    readings: [],
    payingTwice: [],
    cards: [],
    household: [],
    risks: [],
    health: null,
    dismissed,
  }) as unknown as InsuranceTreeInput;

const ids = (dismissed: string[]) =>
  insuranceTree(input(dismissed)).tree.branches.flatMap((b) => b.items.map((i) => i.id));

describe("a cover the person said they don't need", () => {
  it("isn't listed short", () => {
    expect(ids(["disability"]).some((id) => id.includes("disability"))).toBe(false);
  });

  it("is while they haven't said so", () => {
    expect(ids([]).some((id) => id.includes("disability"))).toBe(true);
  });
});
