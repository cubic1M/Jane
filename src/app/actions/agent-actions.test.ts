import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/agent/run", async () => {
  class AnswerError extends Error {}
  return { AnswerError, answerCompany: vi.fn(), runQueuedFor: vi.fn() };
});

import { AnswerError, answerCompany } from "@/lib/agent/run";
import { answer } from "./agent-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("answering a company's question", () => {
  it("sends the signed-in person's answer for their action", async () => {
    expect(await answer(null, form({ actionId: "a1", answer: "Last 4: 4821" }))).toMatchObject({
      ok: true,
    });
    expect(answerCompany).toHaveBeenCalledWith("u1", "a1", "Last 4: 4821");
  });

  it("shows why an answer can't be sent", async () => {
    vi.mocked(answerCompany).mockRejectedValueOnce(new AnswerError("Leave out card numbers."));
    expect(await answer(null, form({ actionId: "a1", answer: "x" }))).toEqual({
      ok: false,
      message: "Leave out card numbers.",
    });
  });
});
