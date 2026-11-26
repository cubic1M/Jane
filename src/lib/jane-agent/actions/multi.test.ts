import { beforeEach, describe, expect, it, vi } from "vitest";

// A plan's steps (CodeRabbit sweep part 2, chunk act-02): background work of a nested step is
// handed up, a transfer still waiting for the partner is not said to "go", and Undo tries every
// transfer.

const schedule = vi.fn();
const cancel = vi.fn();
const take = vi.fn();
vi.mock("@/lib/money-movement/transfers", async () => {
  class TransferError extends Error {}
  return {
    TransferError,
    scheduleTransfer: (...args: unknown[]) => schedule(...args),
    cancelTransfer: (...args: unknown[]) => cancel(...args),
  };
});
vi.mock("../messages", () => ({ postMessages: vi.fn(async () => 1) }));
vi.mock("./index", () => ({ takeChatAction: (...args: unknown[]) => take(...args) }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({ janeMessages: { findFirst: async () => ({ id: "hidden1" }) } }),
}));

import { TransferError } from "@/lib/money-movement/transfers";
import type { ChatMessage, MessageAction, MultiStep } from "../types";
import { multiConfirm, multiUndo } from "./multi";
import type { ActionContext } from "./handler";

const transferStep: MultiStep = {
  kind: "transfer",
  label: "Move $50",
  goalId: null,
  goalName: "Emergency fund",
  fromAccountId: "a1",
  toAccountId: "a2",
  amountCents: 5000,
};
const chatStep: MultiStep = {
  kind: "chat",
  label: "Switch",
  action: "option.pick",
  actionLabel: "Switch",
  body: "Switch?",
  refs: {},
  actions: [],
};

function context(message: Partial<ChatMessage>): ActionContext {
  const action: MessageAction = { id: "multi.confirm", label: "Yes", kind: "primary" };
  return {
    userId: "u1",
    message: { id: "m1", actions: [action], refs: {}, ...message } as ChatMessage,
    action,
    client: {} as never,
    now: new Date("2026-11-01T12:00:00Z"),
  };
}

beforeEach(() => {
  schedule.mockReset();
  cancel.mockReset();
  take.mockReset();
});

describe("multi.confirm", () => {
  it("hands up the background jobs a nested step queued", async () => {
    take.mockResolvedValue({
      message: { refs: { note: "Queued." } },
      agentJobIds: ["job1"],
      agentActionIds: ["act1"],
      posted: false,
    });
    const outcome = await multiConfirm.run(
      context({ refs: { multi: { steps: [chatStep] } } as never }),
    );
    expect(outcome.agentJobIds).toEqual(["job1"]);
    expect(outcome.agentActionIds).toEqual(["act1"]);
  });

  it("does not say money goes on a day when the transfer waits for the partner", async () => {
    schedule.mockResolvedValue({ id: "t1", runOn: "2026-11-04", awaitingPartner: true });
    const outcome = await multiConfirm.run(
      context({ refs: { multi: { steps: [transferStep] } } as never }),
    );
    expect(outcome.note).not.toMatch(/ goes to /);
    expect(outcome.note).toMatch(/waits for/i);
    expect(outcome.actions?.map((a) => a.id)).toContain("multi.undo");
  });
});

describe("multi.undo", () => {
  const answered = (ids: string[]) =>
    context({
      status: "answered",
      refs: {
        multi: {
          steps: [],
          results: ids.map((id) => ({ status: "done", note: "ok", transferId: id })),
        },
      } as never,
    });

  it("still cancels the second transfer when the first has gone through", async () => {
    cancel.mockImplementation(async (_u: string, id: string) => {
      if (id === "t1") throw new TransferError("That transfer has already gone through.");
    });
    const outcome = await multiUndo.run(answered(["t1", "t2"]));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(outcome.note).toMatch(/already gone through/i);
    expect(outcome.note).toMatch(/undone/i);
  });

  it("keeps Undo, for the one left, when a cancel fails for a reason that may pass", async () => {
    cancel.mockImplementation(async (_u: string, id: string) => {
      if (id === "t2") throw new Error("connection reset");
    });
    const outcome = await multiUndo.run(answered(["t1", "t2"]));
    const left = (outcome.refs?.multi?.results ?? []).flatMap((r) =>
      r.transferId ? [r.transferId] : [],
    );
    expect(left).toEqual(["t2"]);
    expect(outcome.actions?.map((a) => a.id)).toContain("multi.undo");
  });
});
