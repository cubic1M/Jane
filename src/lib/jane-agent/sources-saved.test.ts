import { describe, expect, it } from "vitest";
import { gather, type BrainSettings } from "./brain";
import { savedReply } from "./replies-saved";
import type { Snapshot } from "./snapshot";

// Spec step 139: a milestone message for the confirmed total, the highest one passed only,
// and the answer to "how much have you saved me?".

const NOW = new Date("2026-10-19T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };
const snapshot = (confirmedCents?: number) =>
  ({
    timezone: "America/New_York",
    asOf: "2026-10-19",
    weekStart: "2026-10-19",
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
    ...(confirmedCents === undefined ? {} : { saved: { confirmedCents } }),
  }) as Snapshot;
const saved = (s: Snapshot) => gather(s, NOW, SYNC).filter((m) => m.source === "saved");

describe("the saved source", () => {
  it("names the highest milestone passed, once", () => {
    const [m] = saved(snapshot(30_000));
    expect(m).toMatchObject({ kind: "done", dedupeKey: "saved:milestone:25000" });
    expect(m.body).toMatch(/^I've now saved you \$300\.00, and every dollar/);
    expect(m.actions.map((a) => a.id)).toEqual(["saved.share", "open"]);
  });

  it("says nothing below the first milestone, or without the numbers", () => {
    expect(saved(snapshot(4_999))).toEqual([]);
    expect(saved(snapshot())).toEqual([]);
  });
});

describe("savedReply", () => {
  it("keeps the confirmed total apart from estimates", () => {
    const reply = savedReply({
      actions: {
        confirmed: [],
        confirmedCents: 0,
        estimated: [],
        estimatedCents: 6_000,
        notShown: [],
      },
      suggestions: {
        confirmed: [],
        expected: [],
        notSeen: [],
        confirmedCents: 0,
        expectedCents: 3_000,
      },
      confirmedCents: 0,
      expectedCents: 9_000,
    });
    expect(reply.body).toBe(
      "Nothing's confirmed in your transactions yet. About $90.00 a year more is still an estimate until your transactions show it.",
    );
    expect(reply.actions).toEqual([
      { id: "open", label: "See the receipts", kind: "link", href: "/saved" },
    ]);
  });

  it("counts the suggestions the person acted on with Jane's own receipts", () => {
    const outcome = {
      key: "subscriptions:subscriptions",
      topic: "subscriptions",
      title: "Cancel subscriptions you don't use",
      status: "confirmed",
      expectedCents: 12_000,
      confirmedCents: 14_388,
      yearly: true,
      verifiedPercent: 95,
      proof: "Last charged $11.99 on Aug 3, nothing since.",
      evidence: [],
      actedOn: "2026-08-01",
      markedDone: true,
      verifiedOn: "2026-10-01",
    };
    const reply = savedReply({
      actions: { confirmed: [], confirmedCents: 0, estimated: [], estimatedCents: 0, notShown: [] },
      suggestions: {
        confirmed: [outcome],
        expected: [],
        notSeen: [],
        confirmedCents: 14_388,
        expectedCents: 0,
      },
      confirmedCents: 14_388,
      expectedCents: 0,
    });
    expect(reply.body).toBe(
      "I've saved you $143.88 so far, confirmed in your own transactions (1 receipt).",
    );
  });
});
