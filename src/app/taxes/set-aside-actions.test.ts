import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "me" })) }));
vi.mock("@/lib/tax-corrections", async (original) => ({
  ...(await original<typeof import("@/lib/tax-corrections")>()),
  addTaxCorrection: vi.fn(),
  removeTaxCorrection: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { TaxCorrectionError, addTaxCorrection, removeTaxCorrection } from "@/lib/tax-corrections";
import { pointOutAction, undoPointOutAction } from "./set-aside-actions";
import { form } from "@/lib/__fixtures__/form";

describe("pointing something out on the tax calculation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is always for the signed-in person", async () => {
    await pointOutAction(null, form({ kind: "deduction", amount: "120", userId: "someone-else" }));
    expect(vi.mocked(addTaxCorrection).mock.calls[0]?.[0]).toBe("me");
    expect(requireUser).toHaveBeenCalled();
  });

  it("reads dollars as cents and passes the words on", async () => {
    await pointOutAction(null, form({ kind: "deduction", amount: "$1,200.50", label: "Desk" }));
    expect(addTaxCorrection).toHaveBeenCalledWith(
      "me",
      { kind: "deduction", cents: 120_050, label: "Desk" },
      { via: "page" },
    );
  });

  it.each([
    ["paid_federal", "federal"],
    ["paid_state", "state"],
  ])("takes %s as a payment to %s", async (kind, paidTo) => {
    await pointOutAction(null, form({ kind, amount: "500" }));
    expect(addTaxCorrection).toHaveBeenCalledWith(
      "me",
      { kind: "paid", cents: 50_000, label: "", paidTo },
      { via: "page" },
    );
  });

  it("takes a payer for that isn't income", async () => {
    await pointOutAction(null, form({ kind: "not_income", payerKey: "brightleaf" }));
    expect(addTaxCorrection).toHaveBeenCalledWith(
      "me",
      { kind: "not_income", payerKey: "brightleaf" },
      { via: "page" },
    );
  });

  it.each([
    [{ kind: "made_up", amount: "5" }],
    [{ kind: "not_income" }],
    [{ kind: "deduction", amount: "lots" }],
    [{ kind: "deduction" }],
  ])("refuses %j, changing nothing", async (fields) => {
    const state = await pointOutAction(null, form(fields as Record<string, string>));
    expect(state?.ok).toBe(false);
    expect(addTaxCorrection).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("works Home and the working out again when it lands", async () => {
    const state = await pointOutAction(null, form({ kind: "withheld", amount: "4000" }));
    expect(state?.ok).toBe(true);
    expect(vi.mocked(revalidatePath).mock.calls.flat()).toEqual(
      expect.arrayContaining(["/taxes", "/home", "/figures/safe_to_spend"]),
    );
  });

  it("says what's wrong in words", async () => {
    vi.mocked(addTaxCorrection).mockRejectedValueOnce(new TaxCorrectionError("Nope."));
    const state = await pointOutAction(null, form({ kind: "deduction", amount: "5" }));
    expect(state).toEqual({ ok: false, message: "Nope." });
  });
});

describe("undoing it", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is for the signed-in person's own row", async () => {
    const state = await undoPointOutAction(null, form({ id: "row" }));
    expect(removeTaxCorrection).toHaveBeenCalledWith("me", "row", { via: "page" });
    expect(state?.ok).toBe(true);
  });

  it("refuses no id, and says when it's gone", async () => {
    expect((await undoPointOutAction(null, form({})))?.ok).toBe(false);
    vi.mocked(removeTaxCorrection).mockRejectedValueOnce(new TaxCorrectionError("Gone."));
    expect(await undoPointOutAction(null, form({ id: "row" }))).toEqual({
      ok: false,
      message: "Gone.",
    });
  });
});
