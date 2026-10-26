import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decisions")>()),
  undoDecision: vi.fn(),
}));
vi.mock("@/lib/standing-rules", () => ({ undoApproval: vi.fn() }));

import { PICK_UNDO_HOURS } from "@/config/rules";
import { DecisionError, undoDecision } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { undoApproval } from "@/lib/standing-rules";
import { POST } from "./route";

// Revert on a card's answer: a No through undoDecision, a Yes through undoApproval.

const revert = (decisionId: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/decisions/${decisionId}/revert`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ decisionId }) },
  );

describe("POST /api/decisions/[decisionId]/revert", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(undoDecision).mockReset();
    vi.mocked(undoApproval).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await revert("d1", { choice: "yes" })).status).toBe(401);
    expect(undoApproval).not.toHaveBeenCalled();
  });

  it("takes back a Yes while the work hasn't started, and a No within its window", async () => {
    expect((await revert("d1", { choice: "yes" })).status).toBe(200);
    expect(undoApproval).toHaveBeenCalledWith("user_1", "d1", "card", PICK_UNDO_HOURS);
    expect((await revert("d2", { choice: "no" })).status).toBe(200);
    expect(undoDecision).toHaveBeenCalledWith("user_1", "d2");
  });

  it("needs to know which answer, and says why it can't", async () => {
    expect((await revert("d1", {})).status).toBe(400);
    vi.mocked(undoApproval).mockRejectedValue(
      new DecisionError("cannot_undo", "This can't be taken back anymore: the work has started."),
    );
    const response = await revert("d1", { choice: "yes" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "cannot_undo" });
  });
});
