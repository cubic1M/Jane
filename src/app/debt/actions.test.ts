import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/debt-plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/debt-plan")>()),
  startDebtPlan: vi.fn(),
  stopDebtPlan: vi.fn(),
}));

import { DebtPlanError, startDebtPlan, stopDebtPlan } from "@/lib/debt-plan";
import { startPlan, stopPlan } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("payoff plan actions", () => {
  it("starts the plan for the signed-in person with the extra in cents", async () => {
    await expect(startPlan(form({ strategy: "snowball", extra: "150" }))).rejects.toThrow(
      "REDIRECT /debt?saved=started#plan",
    );
    expect(startDebtPlan).toHaveBeenCalledWith("u1", { strategy: "snowball", extraCents: 15_000 });
  });

  it("reads a blank extra as none, and nonsense as a problem to show", async () => {
    await expect(startPlan(form({ strategy: "avalanche", extra: "" }))).rejects.toThrow(
      /saved=started/,
    );
    expect(startDebtPlan).toHaveBeenLastCalledWith("u1", { strategy: "avalanche", extraCents: 0 });
    vi.mocked(startDebtPlan).mockRejectedValueOnce(
      new DebtPlanError("Enter the extra a month in dollars."),
    );
    await expect(startPlan(form({ strategy: "avalanche", extra: "lots" }))).rejects.toThrow(
      "REDIRECT /debt?error=Enter+the+extra+a+month+in+dollars.#plan",
    );
    expect(startDebtPlan).toHaveBeenLastCalledWith("u1", { strategy: "avalanche", extraCents: -1 });
  });

  it("stops the plan", async () => {
    await expect(stopPlan()).rejects.toThrow("REDIRECT /debt?saved=stopped#plan");
    expect(stopDebtPlan).toHaveBeenCalledWith("u1");
  });
});
