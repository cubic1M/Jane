import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/memory/facts", async (original) => ({
  ...(await original<typeof import("@/lib/memory/facts")>()),
  correctFact: vi.fn(async () => {}),
  forgetFact: vi.fn(async () => true),
  forgetEverything: vi.fn(async () => ({
    facts: 0,
    preferences: 0,
    messages: 0,
    conversations: 0,
  })),
}));

import { revalidatePath } from "next/cache";
import { correctFact, forgetEverything, forgetFact, MemoryError } from "@/lib/memory/facts";
import { correctMemoryFact, forgetAllMemory, forgetMemoryFact } from "./actions";

// /settings/memory: correcting and forgetting what Jane knows, only ever the signed-in
// person's own.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("what Jane knows, in Settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("corrects a fact for the signed-in person", async () => {
    expect(await correctMemoryFact(null, form({ factId: "f1", answer: "own" }))).toEqual({
      id: "f1",
      message: "Thanks, I've got that.",
      ok: true,
    });
    expect(correctFact).toHaveBeenCalledWith("u1", "f1", "own");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/memory");
  });

  it("says plainly why a correction wasn't taken", async () => {
    vi.mocked(correctFact).mockRejectedValueOnce(new MemoryError("Answer yes or no."));
    expect(await correctMemoryFact(null, form({ factId: "f1", answer: "maybe" }))).toEqual({
      id: "f1",
      message: "Answer yes or no.",
      ok: false,
    });
  });

  it("forgets one fact", async () => {
    await forgetMemoryFact(form({ factId: "f2" }));
    expect(forgetFact).toHaveBeenCalledWith("u1", "f2");
  });

  it("deletes all memory only with the box ticked", async () => {
    await forgetAllMemory(form({}));
    expect(forgetEverything).not.toHaveBeenCalled();
    await forgetAllMemory(form({ confirm: "yes" }));
    expect(forgetEverything).toHaveBeenCalledWith("u1");
    expect(revalidatePath).toHaveBeenCalledWith("/chat");
  });
});
