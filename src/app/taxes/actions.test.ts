import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/tax-withholding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-withholding")>()),
  recordW4Change: vi.fn(),
  clearW4Change: vi.fn(),
  keepRefund: vi.fn(),
}));
vi.mock("@/lib/tax-organizer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-organizer")>()),
  markTaxForm: vi.fn(async () => ({ form: "W-2", from: "ACME" })),
}));

import { adviceMode } from "@/lib/advice-mode";
import { TaxOrganizerError, markTaxForm } from "@/lib/tax-organizer";
import { clearW4Change, keepRefund, recordW4Change } from "@/lib/tax-withholding";
import { markForm, w4Action } from "./actions";

// Spec step 119: "I have it" and "Not yet" on /taxes.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("markForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ticks a form off for the signed-in person, and back", async () => {
    expect(await markForm(null, form({ year: "2026", key: "w2:acme", received: "1" }))).toEqual({
      ok: true,
      message: "Ticked off: W-2 from ACME.",
    });
    expect(markTaxForm).toHaveBeenCalledWith("u1", 2026, "w2:acme", true, { via: "page" });
    expect(await markForm(null, form({ year: "2026", key: "w2:acme", received: "0" }))).toEqual({
      ok: true,
      message: "OK, still waiting.",
    });
  });

  it("says what went wrong", async () => {
    expect(await markForm(null, form({ year: "x", key: "w2:acme" }))).toMatchObject({ ok: false });
    vi.mocked(markTaxForm).mockRejectedValueOnce(
      new TaxOrganizerError("That form isn't on your list anymore."),
    );
    expect(await markForm(null, form({ year: "2026", key: "nope", received: "1" }))).toEqual({
      ok: false,
      message: "That form isn't on your list anymore.",
    });
  });
});

describe("w4Action (spec step 121)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the W-4 the person sent, in demo advice mode only", async () => {
    expect(
      await w4Action(
        null,
        form({ intent: "sent", step: "4b", amountCents: "6169800", year: "2026" }),
      ),
    ).toEqual({ ok: true, message: "Saved. Your estimate counts it from your next paycheck." });
    expect(recordW4Change).toHaveBeenCalledWith(
      "u1",
      { step: "4b", amountCents: 6_169_800 },
      { via: "page" },
    );
    vi.mocked(adviceMode).mockResolvedValueOnce(false);
    expect(await w4Action(null, form({ intent: "sent", step: "4b", amountCents: "100" }))).toEqual({
      ok: false,
      message: "That's only in demo advice mode.",
    });
    expect(recordW4Change).toHaveBeenCalledTimes(1);
  });

  it("undoes it, and keeps a refund for the year", async () => {
    expect((await w4Action(null, form({ intent: "undo" }))).ok).toBe(true);
    expect(clearW4Change).toHaveBeenCalledWith("u1", { via: "page" });
    expect((await w4Action(null, form({ intent: "keep", year: "2026" }))).ok).toBe(true);
    expect(keepRefund).toHaveBeenCalledWith("u1", 2026, { via: "page" });
    expect(await w4Action(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});
