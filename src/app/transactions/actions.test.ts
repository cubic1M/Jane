import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  hit: vi.fn(async () => ({ ok: false, remaining: 0, retryAfterSeconds: 60 })),
}));
vi.mock("@/detection/engine", () => ({ runDetection: vi.fn() }));
vi.mock("@/lib/categories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/categories")>()),
  correctCategory: vi.fn(async () => ({ updated: 3 })),
  removeMerchantRule: vi.fn(),
}));

import { after } from "next/server";
import { CategoryError, correctCategory, removeMerchantRule } from "@/lib/categories";
import { requireUser } from "@/lib/session";
import { deleteRule, saveCategory } from "./actions";
import { form } from "@/lib/__fixtures__/form";

describe("transaction category actions", () => {
  beforeEach(() => {
    vi.mocked(correctCategory).mockClear();
    vi.mocked(after).mockClear();
  });

  it("saves a temporary person's change, but past the limit doesn't rework everything", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: "trial_own_abc" } as never);
    const answer = await saveCategory(
      null,
      form({ transactionId: "t1", category: "FOOD_AND_DRINK_GROCERIES" }),
    );
    expect(answer).toMatchObject({ ok: true });
    expect(correctCategory).toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("corrects the signed-in person's transaction and refreshes findings afterwards", async () => {
    expect(
      await saveCategory(
        null,
        form({ transactionId: "t1", category: "FOOD_AND_DRINK_GROCERIES", forMerchant: "on" }),
      ),
    ).toEqual({
      ok: true,
      message: "Saved for this merchant: 3 transactions updated, and new ones will follow.",
    });
    expect(correctCategory).toHaveBeenCalledWith("u1", "t1", "FOOD_AND_DRINK_GROCERIES", {
      forMerchant: true,
    });
    expect(after).toHaveBeenCalledOnce();
  });

  it("shows a correction error as a message", async () => {
    vi.mocked(correctCategory).mockRejectedValueOnce(new CategoryError("Pick a category."));
    expect(await saveCategory(null, form({ transactionId: "t1", category: "x" }))).toEqual({
      ok: false,
      message: "Pick a category.",
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("removes the person's own rule", async () => {
    await deleteRule(form({ merchantKey: "corner market" }));
    expect(removeMerchantRule).toHaveBeenCalledWith("u1", "corner market");
  });
});
