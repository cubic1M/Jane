import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decisions")>()),
  recordDecision: vi.fn(),
}));

import { DecisionError, recordDecision } from "@/lib/decisions";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const HASH = "a".repeat(64);
const signedIn = { id: "user_1", email: "a@example.com", role: "user" as const };

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/decisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/decisions", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue(signedIn as never);
    vi.mocked(recordDecision).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await post({ findingId: "f1", choice: "yes", cardHash: HASH })).status).toBe(401);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("records the signed-in user's answer", async () => {
    vi.mocked(recordDecision).mockResolvedValue({ decisionId: "d1", actionId: "a1" });

    const response = await post({ findingId: "f1", choice: "yes", cardHash: HASH });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ decisionId: "d1", actionId: "a1" });
    expect(recordDecision).toHaveBeenCalledWith("user_1", {
      findingId: "f1",
      choice: "yes",
      cardHash: HASH,
    });
  });

  it.each([
    ["invalid JSON", "{"],
    ["a missing choice", { findingId: "f1", cardHash: HASH }],
    ["an unknown choice", { findingId: "f1", choice: "maybe", cardHash: HASH }],
    ["a malformed finding id", { findingId: "../x", choice: "no", cardHash: HASH }],
    ["a malformed card hash", { findingId: "f1", choice: "no", cardHash: "abc" }],
  ])("rejects %s", async (_case, body) => {
    expect((await post(body)).status).toBe(400);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["already_decided", 409],
    ["card_changed", 409],
  ] as const)("answers %s with %i and a readable message", async (code, status) => {
    vi.mocked(recordDecision).mockRejectedValue(new DecisionError(code, "Readable message."));

    const response = await post({ findingId: "f1", choice: "no", cardHash: HASH });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Readable message.", code });
  });

  it("lets unexpected errors surface", async () => {
    vi.mocked(recordDecision).mockRejectedValue(new Error("database down"));

    await expect(post({ findingId: "f1", choice: "no", cardHash: HASH })).rejects.toThrow(
      "database down",
    );
  });
});
