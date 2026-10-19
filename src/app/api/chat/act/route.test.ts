import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/agent/run", () => ({ runAgentNow: vi.fn() }));
vi.mock("@/lib/jane-agent/actions", async () => {
  const { ChatActionError } = await import("@/lib/jane-agent/actions/handler");
  return { ChatActionError, takeChatAction: vi.fn() };
});

import { track } from "@/lib/analytics";
import { ChatActionError, takeChatAction } from "@/lib/jane-agent/actions";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

// Spec step 85: a button on a phone notification answers the message through the chat's
// own checks, only for the signed-in person.

const call = (body: unknown, contentType = "application/json") =>
  POST(
    new Request("http://localhost/api/chat/act", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("/api/chat/act", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(takeChatAction).mockReset();
  });

  it("needs a session: the notification opens the chat instead", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await call({ messageId: "m1", actionId: "finding.yes" })).status).toBe(401);
    expect(takeChatAction).not.toHaveBeenCalled();
  });

  it("only takes JSON, so a form on another site can't post here", async () => {
    const response = await call("messageId=m1&actionId=finding.yes", "text/plain");
    expect(response.status).toBe(415);
    expect(takeChatAction).not.toHaveBeenCalled();
  });

  it("refuses a malformed request", async () => {
    expect((await call("{not json")).status).toBe(400);
    expect((await call({ messageId: 1, actionId: "finding.yes" })).status).toBe(400);
    expect(takeChatAction).not.toHaveBeenCalled();
  });

  it("answers the person's own message through the chat's checks", async () => {
    vi.mocked(takeChatAction).mockResolvedValue({
      message: { kind: "decision", answeredWith: "Yes", refs: { note: "On it." } },
      agentJobIds: ["job1"],
    } as never);
    const response = await call({ messageId: "m1", actionId: "finding.yes" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answeredWith: "Yes", note: "On it." });
    expect(takeChatAction).toHaveBeenCalledWith("u1", "m1", "finding.yes");
    expect(limitOrNull).toHaveBeenCalledWith("decisions", "u1");
    expect(track).toHaveBeenCalledWith("u1", "chat_notification_answered", {
      channel: "push",
      action: "finding.yes",
      kind: "decision",
    });
  });

  it("refuses another person's message, one already answered, or a button it doesn't offer", async () => {
    const cases = [
      [new ChatActionError("not_found", "That message isn't there anymore."), 404],
      [new ChatActionError("not_open", "This one's already been answered."), 409],
      [new ChatActionError("not_offered", "That button isn't on this message."), 400],
      [new ChatActionError("expired", "It's too late to undo this one."), 409],
    ] as const;
    for (const [error, status] of cases) {
      vi.mocked(takeChatAction).mockRejectedValueOnce(error);
      const response = await call({ messageId: "someone-elses", actionId: "finding.yes" });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: error.message });
    }
    expect(track).not.toHaveBeenCalled();
  });
});
