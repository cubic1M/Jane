import { beforeEach, describe, expect, it, vi } from "vitest";

// A switch pick whose plan a connector made shows the same "check the steps, nothing is sent"
// note as a Yes (CodeRabbit sweep part 2, chunk act-02), and the decision is recorded on the
// card's own clock.

const record = vi.fn();
vi.mock("@/lib/decisions", () => ({
  DecisionError: class DecisionError extends Error {},
  UNDO_WINDOW_SECONDS: 10,
  markDiyDone: vi.fn(),
  recordDecision: (...args: unknown[]) => record(...args),
}));
vi.mock("@/lib/cards", () => ({
  ACTION_FOR_FINDING: { subscription_review: "cancel_subscription" },
  CARD_SELECT: { id: true },
  buildCard: () => ({}),
  cardHash: () => "hash",
}));
vi.mock("@/lib/referrals", () => ({ partnerForUser: async () => null }));
vi.mock("../snapshot", () => ({ findingFingerprint: () => "fp" }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    findings: {
      findFirst: async () => ({ id: "f1", type: "subscription_review", status: "new" }),
    },
  }),
}));

import type { ChatMessage, MessageAction } from "../types";
import type { ActionContext } from "./handler";
import { findingNo, findingPick } from "./finding";

const NOW = new Date("2026-11-01T12:00:00Z");

function context(id: string): ActionContext {
  const action: MessageAction = { id: id as MessageAction["id"], label: "Do it", kind: "primary" };
  return {
    userId: "u1",
    message: {
      id: "m1",
      actions: [action],
      refs: { findingId: "f1", fingerprint: "fp", pickOptionId: "opt1" },
    } as unknown as ChatMessage,
    action,
    client: {} as never,
    now: NOW,
  };
}

beforeEach(() => record.mockReset());

describe("finding.pick", () => {
  it("says nothing is sent until the steps are confirmed, when a connector planned it", async () => {
    record.mockResolvedValue({
      decisionId: "d1",
      agentJobId: undefined,
      diy: false,
      connectorActionId: "c1",
    });
    const outcome = await findingPick.run(context("finding.pick"));
    expect(outcome.note).toMatch(/nothing is sent before that/i);
    expect(outcome.actions?.some((a) => a.kind === "link")).toBe(true);
  });
});

describe("finding.no", () => {
  it("counts the Undo window from the clock the decision was recorded on", async () => {
    record.mockResolvedValue({ decisionId: "d2", agentJobId: undefined, diy: false });
    const outcome = await findingNo.run(context("finding.no"));
    expect(record).toHaveBeenCalledWith(
      "u1",
      expect.anything(),
      expect.objectContaining({ now: NOW }),
    );
    expect(new Date(outcome.refs!.undoUntil!).getTime()).toBeGreaterThan(NOW.getTime());
  });
});
