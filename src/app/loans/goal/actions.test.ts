import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/credit-goals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-goals")>()),
  startCreditGoal: vi.fn(),
  completeGoalItems: vi.fn(),
  endCreditGoal: vi.fn(),
}));

import {
  CreditGoalError,
  completeGoalItems,
  endCreditGoal,
  startCreditGoal,
} from "@/lib/credit-goals";
import { endGoalAction, startGoalAction, tickItemAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("a credit score plan", () => {
  it("is started for the signed-in person only on the tap", async () => {
    vi.mocked(startCreditGoal).mockResolvedValueOnce({} as never);
    await expect(
      startGoalAction(form({ kind: "mortgage", targetScore: "740", targetDate: "2027-04-18" })),
    ).rejects.toThrow("REDIRECT /loans/goal?started=1");
    expect(startCreditGoal).toHaveBeenCalledWith("u1", {
      kind: "mortgage",
      targetScore: 740,
      targetDate: "2027-04-18",
    });
  });
  it("ticks off one item and can be ended", async () => {
    vi.mocked(completeGoalItems).mockResolvedValueOnce(1);
    await expect(tickItemAction(form({ goalId: "g1", key: "pay" }))).rejects.toThrow(
      "REDIRECT /loans/goal?ticked=1",
    );
    expect(completeGoalItems).toHaveBeenCalledWith("u1", "g1", ["pay"]);
    vi.mocked(endCreditGoal).mockResolvedValueOnce();
    await expect(endGoalAction(form({ goalId: "g1" }))).rejects.toThrow(
      "REDIRECT /loans/goal?ended=1",
    );
  });
  it("shows why when it can't", async () => {
    vi.mocked(startCreditGoal).mockRejectedValueOnce(
      new CreditGoalError("Pick a date after today."),
    );
    await expect(startGoalAction(form({}))).rejects.toThrow(
      "REDIRECT /loans/goal?error=Pick+a+date+after+today.",
    );
  });
});
