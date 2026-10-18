import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/goals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals")>()),
  addGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

import { GoalError, addGoal, deleteGoal, updateGoal } from "@/lib/goals";
import { removeGoal, saveGoal } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const fields = { name: "Trip", target: "2000", targetDate: "2027-06-01", accountId: "", saved: "" };

describe("goal actions", () => {
  it("adds, updates and deletes for the signed-in person", async () => {
    await saveGoal(null, form(fields));
    expect(addGoal).toHaveBeenCalledWith("u1", fields);
    await saveGoal(null, form({ ...fields, goalId: "g1" }));
    expect(updateGoal).toHaveBeenCalledWith("u1", "g1", fields);
    await removeGoal(form({ goalId: "g1" }));
    expect(deleteGoal).toHaveBeenCalledWith("u1", "g1");
  });

  it("shows validation as a message", async () => {
    vi.mocked(addGoal).mockRejectedValueOnce(new GoalError("Pick a date."));
    expect(await saveGoal(null, form(fields))).toEqual({ ok: false, message: "Pick a date." });
  });
});
