import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/outcomes", () => ({
  markSuggestionDone: vi.fn(),
  OutcomeError: class OutcomeError extends Error {},
}));
vi.mock("@/lib/savings-proof", () => ({ revokeSavedShares: vi.fn(), shareSavedTotal: vi.fn() }));

import { revalidatePath } from "next/cache";
import { markSuggestionDone, OutcomeError } from "@/lib/outcomes";
import { requireUser } from "@/lib/session";
import { markDone } from "./actions";

const form = (key: string) => {
  const data = new FormData();
  data.set("key", key);
  return data;
};

// "I did it" on the ledger (the Done state): the signed-in person's own suggestion, on the
// record from today, and the page shows it.
describe("I did it, on /saved", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(markSuggestionDone).mockReset().mockResolvedValue({ status: "open" });
    vi.mocked(revalidatePath).mockReset();
  });

  it("marks the signed-in person's suggestion done", async () => {
    await markDone(form("subscriptions:subscription_review"));
    expect(markSuggestionDone).toHaveBeenCalledWith("user_1", "subscriptions:subscription_review");
    expect(revalidatePath).toHaveBeenCalledWith("/saved");
  });

  it("does nothing without a key, and shrugs off one that's gone", async () => {
    await markDone(form(""));
    expect(markSuggestionDone).not.toHaveBeenCalled();
    vi.mocked(markSuggestionDone).mockRejectedValueOnce(new OutcomeError("gone"));
    await expect(markDone(form("gone:key"))).resolves.toBeUndefined();
    vi.mocked(markSuggestionDone).mockRejectedValueOnce(new Error("db down"));
    await expect(markDone(form("x:y"))).rejects.toThrow("db down");
  });
});
