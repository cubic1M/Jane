import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/ask/answer", () => ({ askJane: vi.fn() }));
vi.mock("@/lib/ask/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ask/conversations")>()),
  historyFor: vi.fn(async () => []),
  saveExchange: vi.fn(async () => "c1"),
}));

import { askJane } from "@/lib/ask/answer";
import { ConversationMissingError, historyFor, saveExchange } from "@/lib/ask/conversations";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const lines = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("POST /api/ask", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(limitOrNull).mockReset().mockResolvedValue(null);
    vi.mocked(askJane)
      .mockReset()
      .mockImplementation(async (_u, _h, _q, options) => {
        options?.onStatus?.("Searching your transactions…");
        return { kind: "answer", text: "You spent $12.00." };
      });
    vi.mocked(historyFor).mockReset().mockResolvedValue([]);
    vi.mocked(saveExchange).mockReset().mockResolvedValue("c1");
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await post({ question: "Hi" })).status).toBe(401);
  });

  it("is rate limited", async () => {
    vi.mocked(limitOrNull).mockResolvedValue(new Response(null, { status: 429 }) as never);
    expect((await post({ question: "Hi" })).status).toBe(429);
    expect(askJane).not.toHaveBeenCalled();
  });

  it.each([
    ["{"],
    [{ question: "" }],
    [{ question: "x".repeat(501) }],
    [{ question: "Hi", conversationId: "../x" }],
  ])("rejects %j", async (body) => {
    expect((await post(body)).status).toBe(400);
  });

  it("won't continue someone else's conversation", async () => {
    vi.mocked(historyFor).mockRejectedValue(new ConversationMissingError());
    expect((await post({ question: "Hi", conversationId: "other" })).status).toBe(404);
    expect(askJane).not.toHaveBeenCalled();
  });

  it("streams status lines, then the answer, and saves the exchange", async () => {
    const response = await post({ question: "Food?", conversationId: "c1" });

    expect(response.headers.get("content-type")).toContain("ndjson");
    expect(await lines(response)).toEqual([
      { type: "status", text: "Searching your transactions…" },
      { type: "answer", conversationId: "c1", text: "You spent $12.00.", blocked: false },
    ]);
    expect(historyFor).toHaveBeenCalledWith("u1", "c1");
    expect(saveExchange).toHaveBeenCalledWith("u1", "c1", "Food?", {
      kind: "answer",
      text: "You spent $12.00.",
    });
  });

  it("sends an error line if answering fails", async () => {
    vi.mocked(askJane).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await lines(await post({ question: "Hi" }))).toEqual([
      { type: "error", text: "Something went wrong. Try again." },
    ]);
  });
});
