import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decisions")>()),
  markDiyDone: vi.fn(),
}));

import { DecisionError, markDiyDone } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const done = (decisionId: string) =>
  POST(new Request(`http://localhost/api/decisions/${decisionId}/diy-done`, { method: "POST" }), {
    params: Promise.resolve({ decisionId }),
  });

describe("POST /api/decisions/[decisionId]/diy-done", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(markDiyDone).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await done("d1")).status).toBe(401);
    expect(markDiyDone).not.toHaveBeenCalled();
  });

  it("marks the signed-in person's own decision done", async () => {
    expect((await done("d1")).status).toBe(200);
    expect(markDiyDone).toHaveBeenCalledWith("user_1", "d1");
  });

  it("answers 404 for a decision that isn't theirs", async () => {
    vi.mocked(markDiyDone).mockRejectedValue(new DecisionError("not_found", "nope"));
    expect((await done("other")).status).toBe(404);
  });
});
