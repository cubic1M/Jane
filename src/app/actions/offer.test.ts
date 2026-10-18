import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/agent/run", async () => {
  class AnswerError extends Error {}
  return { AnswerError, answerCompany: vi.fn(), markSelfCancelled: vi.fn(), runQueuedFor: vi.fn() };
});
vi.mock("@/lib/voice/calls", () => ({ answerOffer: vi.fn() }));

import { answerOffer } from "@/lib/voice/calls";
import { offer } from "./agent-actions";

const form = (accept: string) => {
  const data = new FormData();
  data.set("actionId", "a1");
  data.set("accept", accept);
  return data;
};

describe("answering an offer made on a call", () => {
  it("accepts or declines for the signed-in person", async () => {
    expect(await offer(null, form("yes"))).toMatchObject({ ok: true });
    expect(answerOffer).toHaveBeenLastCalledWith("u1", "a1", true);
    expect(await offer(null, form("no"))).toMatchObject({ ok: true });
    expect(answerOffer).toHaveBeenLastCalledWith("u1", "a1", false);
  });
});
