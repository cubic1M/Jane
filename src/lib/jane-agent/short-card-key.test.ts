import { describe, expect, it } from "vitest";
import type { Candidate } from "@/lib/investments/short-term";
import { shortCandidate } from "@/lib/investments/__fixtures__/short-term";
import { demoInvestmentSnapshot } from "@/lib/investments/__fixtures__/demo";
import type { Snapshot } from "./snapshot";
import { investmentsSource } from "./sources/investments";

// The manager after gate C (11-24): the short-term money card was keyed by its amount to the
// nearest $1,000, so a goal's card came again each time savings went in. It's keyed by what it
// asks: which pot, and a ladder to build or the place that's best.

const ASOF = "2026-11-24";
const keyOf = (c: Candidate) =>
  investmentsSource
    .gather(
      {
        asOf: ASOF,
        investments: demoInvestmentSnapshot({ advice: true, shortTerm: { candidates: [c] } }),
      } as unknown as Snapshot,
      {} as never,
    )
    .find((m) => m.dedupeKey.startsWith("short:"))?.dedupeKey;

describe("the short-term money card's key", () => {
  it("is the pot and what it asks, whatever the amount", () => {
    expect(keyOf(shortCandidate(2_000_000))).toBeDefined();
    expect(keyOf(shortCandidate(2_000_000))).toBe(keyOf(shortCandidate(2_140_000)));
  });

  it("changes with the pot, or when a ladder comes or goes", () => {
    const c = shortCandidate(2_000_000);
    expect(keyOf(c)).not.toBe(keyOf(shortCandidate(2_000_000, { key: "goal:g2", name: "Car" })));
    expect(keyOf(c)).not.toBe(keyOf(shortCandidate(2_000_000, { withLadder: false })));
  });
});
