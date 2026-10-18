import { beforeEach, describe, expect, it, vi } from "vitest";

// Work after the response (the agent's first step) isn't part of these tests.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/plan", () => ({ answerPlanItem: vi.fn(), yesToAll: vi.fn() }));
vi.mock("@/lib/standing-rules", () => ({ undoRuleApproval: vi.fn() }));
vi.mock("@/lib/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decisions")>()),
  undoDecision: vi.fn(),
}));

import { undoDecision } from "@/lib/decisions";
import { answerPlanItem, yesToAll } from "@/lib/plan";
import { undoRuleApproval } from "@/lib/standing-rules";
import { answerAll, answerItem, undoItem, undoRule } from "./actions";

const HASH = "a".repeat(64);
const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) data.append(k, value);
  }
  return data;
};

describe("plan actions", () => {
  beforeEach(() => vi.mocked(answerPlanItem).mockReset());

  it("answers yes with Jane's defaults, or with the changed options", async () => {
    vi.mocked(answerPlanItem).mockResolvedValue({
      findingId: "f1",
      ok: true,
      decisionId: "d1",
      actionId: "a1",
    });
    const base = { findingId: "f1", cardHash: HASH, actionType: "cancel_subscription" };
    expect(await answerItem(null, form({ ...base, choice: "yes", changed: "false" }))).toEqual({
      kind: "approved",
      changed: false,
    });
    expect(answerPlanItem).toHaveBeenLastCalledWith("u1", {
      findingId: "f1",
      cardHash: HASH,
      choice: "yes",
      options: undefined,
    });

    await answerItem(
      null,
      form({ ...base, choice: "yes", changed: "true", "option.plan": "downgrade" }),
    );
    expect(answerPlanItem).toHaveBeenLastCalledWith("u1", {
      findingId: "f1",
      cardHash: HASH,
      choice: "yes",
      options: { plan: "downgrade" },
    });
  });

  it("returns the decision for a no, so it can be undone", async () => {
    vi.mocked(answerPlanItem).mockResolvedValue({
      findingId: "f1",
      ok: true,
      decisionId: "d9",
      actionId: null,
    });
    expect(
      await answerItem(
        null,
        form({ findingId: "f1", cardHash: HASH, actionType: "card_interest", choice: "no" }),
      ),
    ).toEqual({ kind: "declined", decisionId: "d9" });
    expect(await undoItem(null, form({ decisionId: "d9" }))).toEqual({ kind: "undone" });
    expect(undoDecision).toHaveBeenCalledWith("u1", "d9");
  });

  it("rejects malformed answers before touching the decision log", async () => {
    expect(
      await answerItem(null, form({ findingId: "f1", cardHash: "nope", choice: "yes" })),
    ).toMatchObject({ kind: "error" });
    expect(answerPlanItem).not.toHaveBeenCalled();
  });

  it("says yes to every well-formed item, for the signed-in person", async () => {
    vi.mocked(yesToAll).mockResolvedValue([
      { findingId: "f1", ok: true, decisionId: "d1", actionId: "a1" },
      { findingId: "f2", ok: false, message: "changed" },
    ]);
    await expect(
      answerAll(form({ item: [`f1:${HASH}`, `f2:${HASH}`, "bad:item"] })),
    ).rejects.toThrow("redirect:/plan?approved=1&skipped=1");
    expect(yesToAll).toHaveBeenCalledWith("u1", [
      { findingId: "f1", cardHash: HASH },
      { findingId: "f2", cardHash: HASH },
    ]);
  });

  it("takes back a rule's approval for the signed-in person", async () => {
    expect(await undoRule(null, form({ decisionId: "d5" }))).toEqual({ kind: "undone" });
    expect(undoRuleApproval).toHaveBeenCalledWith("u1", "d5");
  });
});
