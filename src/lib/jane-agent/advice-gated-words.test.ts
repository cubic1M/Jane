import { describe, expect, it } from "vitest";
import type { Saving } from "@/lib/insurance/savings";
import type { Refinance } from "@/lib/refinance";
import { sameCoverBody, savingLine } from "./insurance/saving-words";
import { priorityItems } from "./priorities";
import type { Snapshot } from "./snapshot";

// Manager 11-23: words that pick an offer or move a policy are demo advice, gated in code on
// advice mode, so they can't show for a real account whatever data arrives.

const policy = { id: "p1", carrier: "Geico", kind: "auto" as const };
const saving = (kind: Saving["kind"], cents: number, detail: Saving["detail"] = {}) =>
  ({ id: kind, policyId: "p1", kind, yearlySavingCents: cents, detail }) as Saving;

describe("an insurance bundle", () => {
  const bundle = saving("bundle", 12_000, { withCarrier: "Geico" });

  it("is a line in advice mode, in the decided wording", () => {
    expect(savingLine(bundle, policy, true)).toBe(
      "Your car and Geico policies together with Geico: about $120.00 a year less between them",
    );
  });

  it("is no line on a real account, and isn't counted in the total", () => {
    expect(savingLine(bundle, policy, false)).toBeNull();
    const body = sameCoverBody([bundle, saving("autopay", 3_000)], [policy], false);
    expect(body).not.toMatch(/bundle|together with/i);
    expect(body).toContain("There's a way");
    expect(body).toContain("That's about $30.00 a year");
  });
});

describe("a refinance offer among the priorities", () => {
  const refinance = {
    available: true,
    checkedOn: "2026-11-01",
    comparisons: [
      { debtKey: "car", debtName: "your car loan", termMonths: 36, pick: { savingCents: 90_000 } },
    ],
  } as unknown as Refinance;
  const snapshot = (advice: boolean) =>
    ({
      asOf: "2026-11-23",
      findings: [],
      agentSteps: [],
      deadlines: [],
      refinance,
      ...(advice ? { advice: true } : {}),
    }) as unknown as Snapshot;

  it("shows in advice mode as an offer, not an order", () => {
    const item = priorityItems(snapshot(true)).find((i) => i.key === "refinance:car");
    expect(item?.title).toBe("A refinance offer for your car loan");
  });

  it("doesn't show on a real account", () => {
    expect(priorityItems(snapshot(false)).some((i) => i.key.startsWith("refinance:"))).toBe(false);
  });
});
