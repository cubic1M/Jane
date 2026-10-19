import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec step 81: a tap goes to takeChatAction for the signed-in person only, returns the
// message as it is now (nothing revalidated, so the answer stays on screen), and shows
// a refusal without changing the message.

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as (() => unknown)[] }));
vi.mock("next/server", () => ({ after: vi.fn((cb: () => unknown) => afterCallbacks.push(cb)) }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/agent/run", () => ({ runAgentNow: vi.fn() }));
vi.mock("@/lib/jane-agent/open", () => ({ timezoneOf: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/jane-agent/actions", async () => {
  const { ChatActionError } = await import("@/lib/jane-agent/actions/handler");
  return { ChatActionError, takeChatAction: vi.fn() };
});

import { runAgentNow } from "@/lib/agent/run";
import { ChatActionError, takeChatAction } from "@/lib/jane-agent/actions";
import type { ChatMessage } from "@/lib/jane-agent/types";
import { toView } from "@/lib/jane-agent/view";
import { tapButton, type MessageState } from "./actions";

const stored: ChatMessage = {
  id: "m1",
  kind: "decision",
  body: "Netflix went up.",
  refs: { findingId: "f1", note: "Got it." },
  actions: [{ id: "open", label: "Open", kind: "link", href: "/report/f1" }],
  status: "answered",
  answeredWith: "Yes",
  answeredAt: new Date(),
  createdAt: new Date("2026-10-19T13:00:00Z"),
};
const previous: MessageState = {
  message: toView({ ...stored, status: "open", answeredWith: null }, new Date(), null),
  error: null,
};
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
};

describe("tapButton", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
  });

  it("takes the action for the signed-in person and returns the answered message", async () => {
    vi.mocked(takeChatAction).mockResolvedValue({ message: stored, agentJobIds: ["job1"] });
    const state = await tapButton(previous, form({ messageId: "m1", actionId: "finding.yes" }));
    expect(takeChatAction).toHaveBeenCalledWith("u1", "m1", "finding.yes");
    expect(state.error).toBeNull();
    expect(state.message).toMatchObject({
      id: "m1",
      status: "answered",
      answeredWith: "Yes",
      note: "Got it.",
      buttons: [],
    });
    // The agent's first step runs after the response.
    expect(runAgentNow).not.toHaveBeenCalled();
    for (const callback of afterCallbacks) await callback();
    expect(runAgentNow).toHaveBeenCalledWith(["job1"]);
  });

  it("shows why a tap was refused and leaves the message as it was", async () => {
    vi.mocked(takeChatAction).mockRejectedValue(
      new ChatActionError("not_open", "This one's already been answered."),
    );
    expect(await tapButton(previous, form({ messageId: "m1", actionId: "finding.yes" }))).toEqual({
      message: previous.message,
      error: "This one's already been answered.",
    });
  });

  it("lets unexpected errors through", async () => {
    vi.mocked(takeChatAction).mockRejectedValue(new Error("database down"));
    await expect(tapButton(previous, form({ messageId: "m1", actionId: "x" }))).rejects.toThrow(
      "database down",
    );
  });
});
