import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec step 81: a tap goes to takeChatAction for the signed-in person only, returns the
// message as it is now (nothing revalidated, so the answer stays on screen), and shows
// a refusal without changing the message.

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as (() => unknown)[] }));
vi.mock("next/server", () => ({ after: vi.fn((cb: () => unknown) => afterCallbacks.push(cb)) }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/agent/run", () => ({ runAgentNow: vi.fn(), runQueuedFor: vi.fn() }));
vi.mock("@/lib/jane-agent/open", () => ({ timezoneOf: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/jane-agent/actions", async () => {
  const { ChatActionError } = await import("@/lib/jane-agent/actions/handler");
  return { ChatActionError, takeChatAction: vi.fn() };
});

import { runAgentNow, runQueuedFor } from "@/lib/agent/run";
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
    vi.mocked(takeChatAction).mockResolvedValue({
      message: stored,
      agentJobIds: ["job1"],
      agentActionIds: [],
      posted: false,
    });
    const state = await tapButton(previous, form({ messageId: "m1", actionId: "finding.yes" }));
    expect(takeChatAction).toHaveBeenCalledWith("u1", "m1", "finding.yes", {
      defer: expect.any(Function),
    });
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
    expect(runQueuedFor).not.toHaveBeenCalled();
  });

  // The tap returns before the audit row, the funnel event and closing settled messages.
  it("hands the work the answer doesn't need to after()", async () => {
    vi.mocked(takeChatAction).mockResolvedValue({
      message: stored,
      agentJobIds: [],
      agentActionIds: [],
      posted: false,
    });
    await tapButton(previous, form({ messageId: "m1", actionId: "finding.yes" }));
    const { defer } = vi.mocked(takeChatAction).mock.calls[0][3]!;
    const work = vi.fn(async () => {});
    afterCallbacks.length = 0;
    defer!(work);
    expect(work).not.toHaveBeenCalled();
    for (const callback of afterCallbacks) await callback();
    expect(work).toHaveBeenCalledOnce();
  });

  // Spec step 83: an autopilot level's first approvals start at once, as in Settings.
  it("runs the agent on what a new autopilot level approved, after the response", async () => {
    vi.mocked(takeChatAction).mockResolvedValue({
      message: { ...stored, answeredWith: "Handle the safe stuff" },
      agentJobIds: [],
      agentActionIds: ["a1", "a2"],
      posted: false,
    });
    await tapButton(previous, form({ messageId: "m1", actionId: "autopilot.safe" }));
    expect(runQueuedFor).not.toHaveBeenCalled();
    for (const callback of afterCallbacks) await callback();
    expect(runQueuedFor).toHaveBeenCalledWith(["a1", "a2"]);
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

  // Spec step 88: a clarifying question's button posts an answer, so the chat reloads.
  it("says when a tap posted a new message", async () => {
    vi.mocked(takeChatAction).mockResolvedValue({
      message: stored,
      agentJobIds: [],
      agentActionIds: [],
      posted: true,
    });
    const state = await tapButton(previous, form({ messageId: "m1", actionId: "clarify.1" }));
    expect(state.postedAt).toEqual(expect.any(Number));
    vi.mocked(takeChatAction).mockResolvedValue({
      message: stored,
      agentJobIds: [],
      agentActionIds: [],
      posted: false,
    });
    expect(
      (await tapButton(previous, form({ messageId: "m1", actionId: "finding.yes" }))).postedAt,
    ).toBeUndefined();
  });
});
