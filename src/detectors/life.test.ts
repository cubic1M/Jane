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
    expect(life?.why).toMatch(/Meridian Medical/);
    expect(life?.confidence.percent).toBeLessThanOrEqual(75);
    expect(life?.action.href).toBe("/life-events");
  });

  it("finds no event in lives where nothing changed", () => {
    for (const id of ["renter", "freelancer", "equity", "preretire", "retiree", "debt", "owner"]) {
      expect(run(id, { householdMembers: 0 }).life, id).toBeNull();
    }
  });

  // Night QA 10-30: "Childcare payments began on 2026-08-04", the uploaded statements' first
  // week: payments seen from the start were going on before, and the day read as code.
  it("sees a new child only when childcare starts well after the data does", () => {
    const sample = inputFor("renter");
    const day = (ago: number) =>
      new Date(Date.parse(`${sample.today}T00:00:00Z`) - ago * 86_400_000)
        .toISOString()
        .slice(0, 10);
    // Three months of uploaded statements: the data starts 85 days ago.
    const base = { ...sample, transactions: sample.transactions.filter((t) => t.date >= day(85)) };
    const care = (agos: number[]) =>
      agos.map((ago) => ({
        date: day(ago),
        amountCents: 185_000,
        description: "KINDERCARE LEARNING CTR",
        pfc: "GENERAL_SERVICES_CHILDCARE",
        accountId: base.transactions[0].accountId,
      }));
    const detect = (agos: number[]) => {
      const data = { ...base, transactions: [...base.transactions, ...care(agos)] };
      return lifeChecklist.detect({ profile: buildProfile(data), data });
    };
    const fresh = detect([40, 20, 1]);
    expect(fresh?.title).toMatch(/new-baby checklist/);
    expect(fresh?.short).toMatch(/^Childcare payments began on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    // From the statements' first week on: nothing new about it.
    expect(detect([82, 52, 22])).toBeNull();
  });

  it("suggests a household only to more-than-one-person households not yet in one", () => {
    expect(run("family", { householdMembers: 0 }).household?.action.href).toBe("/household");
    expect(run("preretire", { householdMembers: 0 }).household).not.toBeNull();
    expect(run("family", { householdMembers: 1 }).household).toBeNull();
    expect(run("family").household).toBeNull();
    expect(run("renter", { householdMembers: 0 }).household).toBeNull();
  });
});
