import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/detection/engine", () => ({ runDetection: vi.fn() }));
vi.mock("@/lib/categories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/categories")>()),
  correctCategory: vi.fn(async () => ({ updated: 3 })),
  removeMerchantRule: vi.fn(),
}));

import { after } from "next/server";
import { CategoryError, correctCategory, removeMerchantRule } from "@/lib/categories";
import { deleteRule, saveCategory } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("transaction category actions", () => {
  beforeEach(() => {
    vi.mocked(correctCategory).mockClear();
    vi.mocked(after).mockClear();
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
