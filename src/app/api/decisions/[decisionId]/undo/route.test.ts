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

import { DecisionError, undoDecision } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const undo = (decisionId: string) =>
  POST(new Request(`http://localhost/api/decisions/${decisionId}/undo`, { method: "POST" }), {
    params: Promise.resolve({ decisionId }),
  });

describe("POST /api/decisions/[decisionId]/undo", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(undoDecision).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await undo("d1")).status).toBe(401);
    expect(undoDecision).not.toHaveBeenCalled();
  });

  it("undoes the signed-in user's decision", async () => {
    const response = await undo("d1");

    expect(response.status).toBe(200);
    expect(undoDecision).toHaveBeenCalledWith("user_1", "d1");
  });

  it("answers 409 once the window has passed", async () => {
    vi.mocked(undoDecision).mockRejectedValue(new DecisionError("cannot_undo", "Too late."));

    const response = await undo("d1");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Too late.", code: "cannot_undo" });
  });
});
