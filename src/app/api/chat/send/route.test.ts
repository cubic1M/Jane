import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/jane-agent/typing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jane-agent/typing")>()),
  sendToJane: vi.fn(),
}));

import { TERMS_VERSION } from "@/config/legal";
import { ChatInputError, sendToJane } from "@/lib/jane-agent/typing";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

// Typing to Jane with the answer streamed as it's written: one JSON object per line.

const post = (body: unknown, contentType = "application/json") =>
  POST(
    new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const lines = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("POST /api/chat/send", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1", termsVersion: TERMS_VERSION } as never);
    vi.mocked(sendToJane)
      .mockReset()
      .mockImplementation(async (_u, _t, options) => {
        options?.onEvent?.({ type: "status", text: "Checking your budgets…" });
        options?.onEvent?.({ type: "text", text: "You have $40.00 left for food." });
        return {} as never;
      });
  });

  it("refuses visitors who aren't signed in, or haven't accepted the Terms", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    expect((await post({ message: "hi" })).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1", termsVersion: "old" } as never);
    expect((await post({ message: "hi" })).status).toBe(403);
    expect(sendToJane).not.toHaveBeenCalled();
  });

  it("only takes JSON with a message, so a form on another site can't post here", async () => {
    expect((await post("message=hi", "application/x-www-form-urlencoded")).status).toBe(415);
    expect((await post("{")).status).toBe(400);
    expect((await post({ message: 5 })).status).toBe(400);
    expect(sendToJane).not.toHaveBeenCalled();
  });

  it("streams what Jane is doing and its answer, then done", async () => {
    const response = await post({ message: "how's my food budget" });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await lines(response)).toEqual([
      { type: "status", text: "Checking your budgets…" },
      { type: "text", text: "You have $40.00 left for food." },
      { type: "done" },
    ]);
    expect(vi.mocked(sendToJane).mock.calls[0].slice(0, 2)).toEqual(["u1", "how's my food budget"]);
  });

  it("says what's wrong with the message, and nothing more when something else fails", async () => {
    vi.mocked(sendToJane).mockRejectedValueOnce(
      new ChatInputError("too_long", "Keep it under 500 characters."),
    );
    expect(await lines(await post({ message: "x" }))).toEqual([
      { type: "error", text: "Keep it under 500 characters." },
    ]);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendToJane).mockRejectedValueOnce(new Error("my rent is $2,000"));
    expect(await lines(await post({ message: "my rent is $2,000" }))).toEqual([
      { type: "error", text: "Something went wrong. Try again." },
    ]);
    // Never the person's words.
    expect(JSON.stringify(errors.mock.calls)).not.toContain("rent");
    errors.mockRestore();
  });
});
