import { beforeEach, describe, expect, it, vi } from "vitest";

const { pickOffered, after } = vi.hoisted(() => ({ pickOffered: vi.fn(), after: vi.fn() }));
class StalePick extends Error {}
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/agent/run", () => ({ runAgentNow: vi.fn() }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/jane-agent/actions/options", () => ({
  pickOffered,
  isPickError: (e: unknown) => e instanceof StalePick,
}));

import { pickCompared } from "./compare-actions";

// A pick on the comparison cards goes through the lane's own picker, which prices the options
// again; what the screen sends is only the card's topic and the option's id.

describe("pickCompared", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues the pick through the lane's picker, for the signed-in person", async () => {
    pickOffered.mockResolvedValue({ note: "Got it. My team will add that cover." });
    const result = await pickCompared({ kind: "insurance", topic: "life", policyId: null }, "need");
    expect(result).toEqual({ ok: true, note: "Got it. My team will add that cover." });
    expect(pickOffered).toHaveBeenCalledWith("u1", { kind: "insurance", topic: "life" }, "need");
    expect(after).not.toHaveBeenCalled();
  });

  it("passes the policy, and starts the agent for a switch", async () => {
    pickOffered.mockResolvedValue({ note: "Switching.", agentJobId: "j1" });
    await pickCompared({ kind: "insurance", topic: "switch:s1", policyId: "p1" }, "q1");
    expect(pickOffered).toHaveBeenCalledWith(
      "u1",
      { kind: "insurance", topic: "switch:s1", policyId: "p1" },
      "q1",
    );
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("says why a stale option can't be picked", async () => {
    pickOffered.mockRejectedValue(new StalePick("That option isn't available anymore."));
    expect(await pickCompared({ kind: "loan", topic: "refinance", policyId: null }, "x")).toEqual({
      ok: false,
      error: "That option isn't available anymore.",
    });
  });

  it("refuses what isn't a card's option before asking any lane", async () => {
    for (const [target, id] of [
      [{ kind: "cash", topic: "x", policyId: null }, "a"],
      [{ kind: "loan", topic: "x".repeat(200), policyId: null }, "a"],
      [{ kind: "loan", topic: "refinance", policyId: null }, ""],
    ] as const) {
      const result = await pickCompared(target as never, id);
      expect(result.ok).toBe(false);
    }
    expect(pickOffered).not.toHaveBeenCalled();
  });

  it("lets other errors through", async () => {
    pickOffered.mockRejectedValue(new Error("db down"));
    await expect(
      pickCompared({ kind: "loan", topic: "refinance", policyId: null }, "a"),
    ).rejects.toThrow("db down");
  });
});
