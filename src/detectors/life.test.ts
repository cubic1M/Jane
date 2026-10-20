import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { LIFE_DETECTORS } from "./life";

// Spec step 264: life events and households.
const [lifeChecklist, householdSetup] = LIFE_DETECTORS;
const run = (id: string, extras?: { householdMembers: number }) => {
  const data = { ...inputFor(id), extras };
  const ctx = { profile: buildProfile(data), data };
  return { life: lifeChecklist.detect(ctx), household: householdSetup.detect(ctx) };
};

describe("life event and household detectors", () => {
  it("sees the Reyes family's job change two months ago, as a guess", () => {
    const { life } = run("family", { householdMembers: 0 });
    expect(life?.title).toMatch(/new-job checklist/);
    expect(life?.why).toMatch(/RIVERSIDE ACADEMY/);
    expect(life?.confidence.percent).toBeLessThanOrEqual(75);
    expect(life?.action.href).toBe("/life-events");
  });

  it("finds no event in lives where nothing changed", () => {
    for (const id of ["renter", "freelancer", "equity", "preretire", "retiree", "debt", "owner"]) {
      expect(run(id, { householdMembers: 0 }).life, id).toBeNull();
    }
  });

  it("suggests a household only to more-than-one-person households not yet in one", () => {
    expect(run("family", { householdMembers: 0 }).household?.action.href).toBe("/household");
    expect(run("preretire", { householdMembers: 0 }).household).not.toBeNull();
    expect(run("family", { householdMembers: 1 }).household).toBeNull();
    expect(run("family").household).toBeNull();
    expect(run("renter", { householdMembers: 0 }).household).toBeNull();
  });
});
