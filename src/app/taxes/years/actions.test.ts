import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/multi-year", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/multi-year")>()),
  addPlanEvent: vi.fn(),
  removePlanEvent: vi.fn(),
  setRetireYear: vi.fn(),
  putMoveOnPlan: vi.fn(async () => ({ title: "Convert $10,000 to a Roth IRA in 2027" })),
}));

import {
  MultiYearError,
  addPlanEvent,
  putMoveOnPlan,
  removePlanEvent,
  setRetireYear,
} from "@/lib/multi-year";
import { yearsAction } from "./actions";

// Spec step 220: the retirement year, planned events and putting a move on the plan.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("tax years actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the retirement year, adds and removes an event, and puts a move on the plan", async () => {
    expect(await yearsAction(null, form({ intent: "retire", retireYear: "2045" }))).toMatchObject({
      ok: true,
    });
    expect(setRetireYear).toHaveBeenCalledWith("u1", 2045, { via: "page" });
    await yearsAction(null, form({ intent: "retire", retireYear: "" }));
    expect(setRetireYear).toHaveBeenLastCalledWith("u1", null, { via: "page" });
    expect(
      await yearsAction(
        null,
        form({ intent: "add", kind: "bonus", year: "2028", amount: "25,000" }),
      ),
    ).toMatchObject({ ok: true });
    expect(addPlanEvent).toHaveBeenCalledWith(
      "u1",
      { kind: "bonus", year: 2028, amountCents: 2_500_000 },
      { via: "page" },
    );
    await yearsAction(null, form({ intent: "remove", id: "e1" }));
    expect(removePlanEvent).toHaveBeenCalledWith("u1", "e1");
    expect(await yearsAction(null, form({ intent: "plan", key: "roth:2027" }))).toEqual({
      ok: true,
      message: "On your deadlines: Convert $10,000 to a Roth IRA in 2027.",
    });
    expect(putMoveOnPlan).toHaveBeenCalledWith("u1", "roth:2027", { via: "page" });
  });

  it("says what's wrong", async () => {
    expect(
      await yearsAction(null, form({ intent: "add", kind: "bonus", year: "2028", amount: "lots" })),
    ).toEqual({
      ok: false,
      message: "Give the amount in dollars.",
    });
    vi.mocked(setRetireYear).mockRejectedValueOnce(
      new MultiYearError("Give a year from 2026 to 2060."),
    );
    expect(await yearsAction(null, form({ intent: "retire", retireYear: "1990" }))).toEqual({
      ok: false,
      message: "Give a year from 2026 to 2060.",
    });
    expect(await yearsAction(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});
