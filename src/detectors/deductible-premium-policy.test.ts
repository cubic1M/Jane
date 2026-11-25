import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { computeNeeds, needInputFromProfile } from "@/lib/insurance/need";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { COVER_GAP_DETECTORS } from "./cover-gaps";

// CodeRabbit sweep 1c, det-01 finding 5: the saving from a higher deductible was taken from every
// car and home premium, though only the policy whose deductible changes gets cheaper.
const deductibleFit = COVER_GAP_DETECTORS.find((d) => d.topic === "deductible_fit")!;
const family = inputFor("family");
const account = family.accounts.find((a) => a.type === "depository")!.id;
const monthly = (name: string): ProfileInput["transactions"] =>
  ["2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map(
    (date, i) => ({
      id: `p-${name}-${i}`,
      date,
      amountCents: 20_000,
      description: name,
      pfc: "GENERAL_SERVICES_INSURANCE",
      accountId: account,
    }),
  );
const withPremiums = (name: string): ProfileInput => ({
  ...family,
  transactions: [
    ...family.transactions.filter((t) => t.pfc !== "GENERAL_SERVICES_INSURANCE"),
    ...monthly(name),
  ],
});
const fire = (data: ProfileInput) => {
  const profile = buildProfile(data);
  return deductibleFit.detect({ profile, data });
};
// The kind of policy whose deductible the card is about.
const kindOfNeed = () => {
  const profile = buildProfile(family);
  const input = needInputFromProfile(profile, family)!;
  const needs = computeNeeds(input).filter((n) => n.kind === "deductible" && n.direction !== "ok");
  const need = needs.find((n) => n.direction === "lower") ?? needs[0]!;
  return { need, kind: input.policies.find((p) => p.id === need.policyId)?.kind };
};

describe("the deductible card's yearly saving", () => {
  it("takes the premium of the policy whose deductible would change, not the other cover's", () => {
    const { need, kind } = kindOfNeed();
    expect(need.direction).toBe("raise");
    const mine = kind === "auto" ? "GEICO AUTO PREMIUM" : "STATE FARM HOMEOWNERS";
    const other = kind === "auto" ? "STATE FARM HOMEOWNERS" : "GEICO AUTO PREMIUM";
    expect(fire(withPremiums(mine))?.worthCents ?? 0).toBeGreaterThan(0);
    expect(fire(withPremiums(other))).toBeNull();
  });
});
