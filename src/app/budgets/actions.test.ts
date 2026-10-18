import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/budgets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/budgets")>()),
  setBudget: vi.fn(),
  removeBudget: vi.fn(),
}));

import { BudgetError, removeBudget, setBudget } from "@/lib/budgets";
import { deleteBudget, saveBudget } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("budget actions", () => {
  it("sets and removes the signed-in person's budgets", async () => {
    expect(await saveBudget(null, form({ category: "Food and drink", amount: "400" }))).toEqual({
      ok: true,
      message: "Saved.",
    });
    expect(setBudget).toHaveBeenCalledWith("u1", "Food and drink", "400");
    await deleteBudget(form({ category: "Food and drink" }));
    expect(removeBudget).toHaveBeenCalledWith("u1", "Food and drink");
  });

  it("shows validation as a message", async () => {
    vi.mocked(setBudget).mockRejectedValueOnce(new BudgetError("Pick a category."));
    expect(await saveBudget(null, form({ category: "x", amount: "1" }))).toEqual({
      ok: false,
      message: "Pick a category.",
    });
  });
});
