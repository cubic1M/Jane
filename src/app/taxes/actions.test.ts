import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tax-organizer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-organizer")>()),
  markTaxForm: vi.fn(async () => ({ form: "W-2", from: "ACME" })),
}));

import { TaxOrganizerError, markTaxForm } from "@/lib/tax-organizer";
import { markForm } from "./actions";

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
