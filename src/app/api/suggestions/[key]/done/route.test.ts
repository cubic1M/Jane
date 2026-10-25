import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/outcomes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outcomes")>()),
  markSuggestionDone: vi.fn(async () => ({ status: "open" })),
}));

import { markSuggestionDone, OutcomeError } from "@/lib/outcomes";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const done = (key: string) =>
  POST(new Request(`http://localhost/api/suggestions/${key}/done`, { method: "POST" }), {
    params: Promise.resolve({ key }),
  });

describe("POST /api/suggestions/[key]/done", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(markSuggestionDone).mockClear();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await done("subscriptions%3Asubscriptions")).status).toBe(401);
    expect(markSuggestionDone).not.toHaveBeenCalled();
  });

  it("marks the signed-in person's own suggestion done, by its key", async () => {
    const response = await done("subscriptions%3Asubscriptions");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "open" });
    expect(markSuggestionDone).toHaveBeenCalledWith("user_1", "subscriptions:subscriptions");
  });

  it("answers 404 for a suggestion that isn't theirs or isn't there", async () => {
    vi.mocked(markSuggestionDone).mockRejectedValueOnce(new OutcomeError("gone"));
    expect((await done("x%3Ay")).status).toBe(404);
  });
});
