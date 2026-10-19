import { describe, expect, it } from "vitest";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { InsuranceSnapshot } from "./insurance/snapshot";
import { gather, type BrainSettings } from "./brain";
import type { Snapshot } from "./snapshot";

// Spec step 99: "I found your car insurance from your payments", once per found policy,
// with Confirm and Not insurance; never for confirmed policies or other sources.

const MORNING = new Date("2026-10-19T13:00:00Z");
const SYNC: BrainSettings = { trigger: "sync" };

type SnapshotPolicy = InsuranceSnapshot["policies"][number];
const policy = (over: Partial<SnapshotPolicy>): SnapshotPolicy =>
  ({
    id: "p1",
    kind: "auto",
    carrier: "Progressive",
    status: "found",
    source: "payments",
    premiumCents: 11_800,
    premiumFrequency: "monthly",
    nextRenewal: "2027-01-05",
    ...over,
  }) as SnapshotPolicy;

const snapshot = (policies: SnapshotPolicy[]) =>
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
    insurance: { policies, gaps: [], household: {}, advice: false },
  }) as unknown as Snapshot;
const found = (s: Snapshot) => gather(s, MORNING, SYNC).filter((m) => m.source === "found");

describe("the found policies source", () => {
  it("asks to confirm a policy found from payments", () => {
    const [m] = found(snapshot([policy({})]));
    expect(m).toMatchObject({
      kind: "decision",
      body: "I found your car insurance from your payments: Progressive, $118.00 a month. It looks like it renews around Jan 5 (an estimate from when the payments started). Is that right? It only counts on your profile once you confirm it.",
      refs: { policyId: "p1" },
      dedupeKey: "found:p1",
      priority: MESSAGE_PRIORITY.found_policy,
    });
    expect(m.actions.map((a) => a.id)).toEqual(["policy.confirm", "policy.not_insurance", "open"]);
  });

  it("words an unknown insurer and a missing price plainly", () => {
    const [m] = found(snapshot([policy({ kind: "other", premiumCents: null, nextRenewal: null })]));
    expect(m.body).toBe(
      "I found your insurance from your payments: Progressive. Is that right? It only counts on your profile once you confirm it.",
    );
  });

  it("stays quiet about confirmed, typed or demo policies, and without insurance", () => {
    expect(
      found(
        snapshot([
          policy({ status: "active" }),
          policy({ id: "p2", source: "demo", status: "found" }),
        ]),
      ),
    ).toEqual([]);
    expect(found({ ...snapshot([]), insurance: undefined })).toEqual([]);
  });
});
