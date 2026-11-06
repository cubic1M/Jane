import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { insurerKind } from "@/insights/found-policies";
import { coverageGaps } from "@/lib/insurance/gaps";
import { resolveHousehold } from "@/lib/insurance/household";
import type { Policy } from "@/lib/insurance/policies";
import { parseInsurance } from "./intents";
import { insuranceReply } from "./replies";
import type { InsuranceSnapshot } from "./snapshot";

// Night round 11-06, the sample family: "STATE FARM HOME" and "STATE FARM AUTO" both have the
// merchant "State Farm", so the home policy was found as a second car policy, and "when does my
// car insurance renew" said "I don't have the renewal date for your State Farm car insurance."
// twice.
const ASOF = "2026-11-05";

describe("the kind of cover a payment is for", () => {
  it("reads the charge's own words when the merchant's name leaves it out", () => {
    expect(insurerKind("state farm", "STATE FARM HOME")).toBe("home");
    expect(insurerKind("state farm", "STATE FARM AUTO")).toBe("auto");
    expect(insurerKind("state farm", "STATE FARM RENTERS #22")).toBe("renters");
  });

  it("keeps the insurer's usual kind when the words say nothing more", () => {
    expect(insurerKind("state farm")).toBe(insurerKind("state farm", "STATE FARM INS 8841"));
    expect(insurerKind("geico", "GEICO *PAYMENT")).toBe("auto");
    expect(insurerKind("fern market", "FERN MARKET HOME")).toBeNull();
  });
});

describe("two policies alike", () => {
  const found = (id: string, premiumCents: number): Policy & { nextRenewal: null } =>
    ({
      id,
      kind: "auto",
      carrier: "State Farm",
      status: "found",
      source: "payments",
      premiumCents,
      premiumFrequency: "monthly",
      deductibleCents: null,
      coverage: null,
      covers: null,
      renewalDate: null,
      termMonths: 12,
      documentId: null,
      merchantKey: "state farm",
      nextRenewal: null,
    }) as never;
  const facts = resolveHousehold(
    { housing: null, vehicles: null, dependants: null, pets: null, dismissedGaps: [] },
    { mortgage: false, homeOwned: false, rentPaid: false, cars: 0 },
  );
  const policies = [found("a", 21_200), found("b", 13_800)];
  const insurance = {
    policies,
    household: facts,
    gaps: coverageGaps(facts, policies),
    advice: false,
    canQuote: false,
    shopsItself: false,
    shops: [],
    noBetter: [],
  } as unknown as InsuranceSnapshot;

  it("say the same line once", () => {
    const body = insuranceReply(
      parseInsurance("when does my car insurance renew")!,
      insurance,
      ASOF,
    ).body;
    expect(
      body.match(/I don't have the renewal date for your State Farm car insurance\./g),
    ).toHaveLength(1);
  });
});
