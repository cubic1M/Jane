import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { coverageGaps } from "@/lib/insurance/gaps";
import { resolveHousehold, type Household } from "@/lib/insurance/household";
import type { Policy } from "@/lib/insurance/policies";
import type { OfferedSuggestion } from "@/lib/suggestions";
import { insuranceSource } from "../sources/insurance";
import type { Snapshot } from "../snapshot";
import type { InsuranceSnapshot } from "./snapshot";

// Debug 2, sixth desktop sweep (11-18, upload S6: a renter with no renters policy): the dock had the
// day's "Note your things have no renters cover" (belongings_cover) and the gap's "No renters
// insurance on file." together: one missing cover, two cards. A gap a day's suggestion is about
// is said by the suggestion.

const ASOF = "2026-10-19";
const MORNING = new Date("2026-10-19T13:00:00Z");

const policy = (over: Partial<Policy & { nextRenewal: string | null }> = {}) => ({
  id: "p1",
  kind: "auto" as const,
  carrier: "GEICO",
  status: "active" as const,
  source: "demo" as const,
  premiumCents: 14_200,
  premiumFrequency: "monthly" as const,
  deductibleCents: 100_000,
  coverage: { bodilyInjuryPerPerson: 5_000_000, collision: true, comprehensive: true },
  covers: "One car, two drivers.",
  renewalDate: "2026-11-28",
  termMonths: 12,
  documentId: null,
  merchantKey: "geico",
  nextRenewal: "2026-11-28",
  ...over,
});

const household = (
  over: Partial<Parameters<typeof resolveHousehold>[0] & object> = {},
): Household =>
  resolveHousehold(
    { housing: null, vehicles: null, dependants: null, pets: null, dismissedGaps: [], ...over },
    { mortgage: false, homeOwned: false, rentPaid: false, cars: 0 },
  );

function insurance(
  policies = [policy()],
  facts = household(),
  advice = false,
  canQuote = false,
): InsuranceSnapshot {
  return {
    policies,
    household: facts,
    gaps: coverageGaps(facts, policies),
    advice,
    canQuote,
    shopsItself: advice && canQuote,
    shops: [],
    noBetter: [],
  };
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    timezone: "America/New_York",
    asOf: ASOF,
    weekStart: ASOF,
    safeToSpend: null,
    comingUp: [],
    waitingOnYou: [],
    findings: [],
    plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
    ruleApprovals: [],
    finished: [],
    deadlines: [],
    budgetsOver: [],
    goalsBehind: [],
    urgentAlerts: [],
    budgetProgress: [],
    autopilot: "safe",
    setupProposals: [],
    agentSteps: [],
    assetPrompts: [],
    ...over,
  };
}

const offered = (topic: string) =>
  ({ id: "s1", chosenOn: ASOF, key: `insurance:${topic}`, topic }) as unknown as OfferedSuggestion;

describe("a missing cover beside the day's suggestion about it", () => {
  const gaps = (s: Snapshot) =>
    insuranceSource.gather(s, { now: MORNING } as never).map((m) => m.dedupeKey);
  const renter = insurance([], household({ housing: "rent" }));

  it("isn't its own card while the suggestion is one of the day's", () => {
    expect(
      gaps(snapshot({ insurance: renter, suggestions: [offered("belongings_cover")] })),
    ).not.toContain("gap:renters");
  });

  it("is its own card otherwise", () => {
    expect(
      gaps(snapshot({ insurance: renter, suggestions: [offered("emergency_fund")] })),
    ).toContain("gap:renters");
  });
});
