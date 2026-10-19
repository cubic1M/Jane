import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/self-employed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/self-employed")>()),
  saveHomeOffice: vi.fn(),
  saveMiles: vi.fn(),
  recordTaxPayment: vi.fn(),
}));

import { adviceMode } from "@/lib/advice-mode";
import {
  SelfEmployedError,
  recordTaxPayment,
  saveHomeOffice,
  saveMiles,
} from "@/lib/self-employed";
import { saveHelper } from "./actions";

// Spec step 123: the freelance taxes page's helpers.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("saveHelper", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the home office, clearing it when empty", async () => {
    expect(await saveHelper(null, form({ intent: "office", sqft: "150" }))).toMatchObject({
      ok: true,
    });
    expect(saveHomeOffice).toHaveBeenCalledWith("u1", 150, { via: "page" });
    await saveHelper(null, form({ intent: "office", sqft: "" }));
    expect(saveHomeOffice).toHaveBeenLastCalledWith("u1", null, { via: "page" });
  });

  it("saves miles, with commas", async () => {
    await saveHelper(null, form({ intent: "miles", miles: "1,200" }));
    expect(saveMiles).toHaveBeenCalledWith("u1", 1200, { via: "page" });
  });

  it("adds a payment made elsewhere, in demo advice mode only", async () => {
    await saveHelper(
      null,
      form({ intent: "payment", date: "2026-09-15", amount: "1,500.00", to: "federal" }),
    );
    expect(recordTaxPayment).toHaveBeenCalledWith(
      "u1",
      { date: "2026-09-15", cents: 150_000, to: "federal" },
      { via: "page" },
    );
    vi.mocked(adviceMode).mockResolvedValueOnce(false);
    expect(
      await saveHelper(null, form({ intent: "payment", date: "2026-09-15", amount: "1" })),
    ).toMatchObject({ ok: false });
  });

  it("says what's wrong", async () => {
    vi.mocked(saveMiles).mockRejectedValueOnce(
      new SelfEmployedError("Give the miles as a whole number."),
    );
    expect(await saveHelper(null, form({ intent: "miles", miles: "lots" }))).toEqual({
      ok: false,
      message: "Give the miles as a whole number.",
    });
    expect(await saveHelper(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});
