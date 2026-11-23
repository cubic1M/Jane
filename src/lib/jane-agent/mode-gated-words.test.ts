import { describe, expect, it } from "vitest";
import type { Claim } from "@/lib/insurance/claim-rules";
import type { LifeApplication } from "@/lib/insurance/life";
import type { Saving } from "@/lib/insurance/savings";
import type { PaycheckPlanView } from "@/lib/money-movement/paycheck";
import { draftActions } from "./insurance/done-by-jane-words";
import { decisionStep } from "./insurance/life-words";
import { savingLine } from "./insurance/saving-words";
import { priorityItems } from "./priorities";
import { conciergeYes } from "./replies-changes";
import { paycheckReply } from "./replies-paycheck";
import type { Snapshot } from "./snapshot";

// Manager 11-23: where the words name something Jane itself does for the person (the concierge,
// moving money, demo advice), they're kept and gated in code on that mode; where the surface still
// shows without it, the neutral form.

const labels = (actions: { label: string }[]) => actions.map((a) => a.label);

describe("words gated on the concierge", () => {
  it("a claim draft: File it only when Jane files it", () => {
    const claim = { id: "c1" } as Claim;
    expect(labels(draftActions(claim, true))[0]).toBe("File it");
    expect(labels(draftActions(claim, false))[0]).toBe("Looks right");
  });

  it("a new subscription: Cancel it only when Jane cancels it", () => {
    expect(conciergeYes("subscription_review", true)).toBe("Cancel it");
    expect(conciergeYes("subscription_review", false)).toBeNull();
    expect(conciergeYes("bank_fees", true)).toBeNull();
  });
});

describe("words gated on a money partner", () => {
  const plan = {
    id: "p1",
    status: "proposed",
    paycheckCents: 200_000,
    moves: [{ id: "m1", status: "asked", cents: 20_000, label: "savings", purpose: "goal" }],
    kept: null,
  } as unknown as PaycheckPlanView;

  it("the paycheck split: Move them only when it can move money", () => {
    expect(labels(paycheckReply(plan, true, null, true).actions)).toContain("Move them");
    const without = labels(paycheckReply(plan, true, null, false).actions);
    expect(without).toContain("Go ahead");
    expect(without).not.toContain("Move them");
  });
});

describe("words gated on demo advice", () => {
  it("paperless billing: a line only in advice mode", () => {
    const paperless = {
      id: "s1",
      policyId: "p1",
      kind: "paperless",
      yearlySavingCents: 2_400,
      detail: {},
    } as unknown as Saving;
    const policy = { id: "p1", carrier: "Geico", kind: "auto" as const };
    expect(savingLine(paperless, policy, true)).toBe(
      "Paperless billing on your Geico car policy: about $24.00 a year less",
    );
    expect(savingLine(paperless, policy, false)).toBeNull();
  });

  it("a life-cover offer: Buy it only in advice mode", () => {
    const application = {
      amountCents: 50_000_000,
      termYears: 20,
      quoteId: null,
      quotes: [],
      decision: { outcome: "offered", premiumCents: 3_000, rateClass: "preferred" },
    } as unknown as LifeApplication;
    const offered = decisionStep(application, "America/Los_Angeles", true);
    expect(offered.body).toMatch(/Buy it\?/);
    expect(labels(offered.actions)).toContain("Buy it");
    const real = decisionStep(application, "America/Los_Angeles", false);
    expect(real.body).not.toMatch(/buy/i);
    expect(labels(real.actions)).not.toContain("Buy it");
  });

  it("an insurance quote among the priorities: only in advice mode, as a quote", () => {
    const snapshot = (advice: boolean) =>
      ({
        asOf: "2026-11-23",
        findings: [],
        agentSteps: [],
        deadlines: [],
        insurance: {
          policies: [{ id: "p1", carrier: "Geico", kind: "auto", nextRenewal: null }],
          shops: [
            { id: "s1", policyId: "p1", savingCents: 30_000, pick: { carrier: { name: "Root" } } },
          ],
        },
        ...(advice ? { advice: true } : {}),
      }) as unknown as Snapshot;
    expect(priorityItems(snapshot(true)).find((i) => i.key === "shop:s1")?.title).toBe(
      "Root's quote for your Geico policy",
    );
    expect(priorityItems(snapshot(false)).some((i) => i.key.startsWith("shop:"))).toBe(false);
  });
});
