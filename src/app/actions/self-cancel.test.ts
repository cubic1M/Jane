import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/agent/run", async () => {
  class AnswerError extends Error {}
  return {
    AnswerError,
    answerCompany: vi.fn(),
    markSelfCancelled: vi.fn(),
    runQueuedFor: vi.fn(),
  };
});

import { AnswerError, markSelfCancelled } from "@/lib/agent/run";
import { cancelled } from "./agent-actions";

const form = (actionId: string) => {
  const data = new FormData();
  data.set("actionId", actionId);
  return data;
};

describe("I've cancelled it", () => {
  it("records the signed-in person's own cancellation", async () => {
    expect(await cancelled(null, form("a1"))).toMatchObject({ ok: true });
    expect(markSelfCancelled).toHaveBeenCalledWith("u1", "a1");
  });

  it("explains when Jane isn't waiting on one", async () => {
    vi.mocked(markSelfCancelled).mockRejectedValueOnce(new AnswerError("Not waiting."));
    expect(await cancelled(null, form("a1"))).toEqual({ ok: false, message: "Not waiting." });
  });
});
