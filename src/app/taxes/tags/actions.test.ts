import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tax-organizer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-organizer")>()),
  setTaxTag: vi.fn(async () => ({ count: 1 })),
}));

import { revalidatePath } from "next/cache";
import { TaxOrganizerError, setTaxTag } from "@/lib/tax-organizer";
import { changeTag } from "./actions";

// Spec step 119: changing a tax tag on /taxes/tags.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("changeTag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags one transaction for the signed-in person", async () => {
    expect(await changeTag(null, form({ transactionId: "t1", tag: "work" }))).toEqual({
      ok: true,
      message: "Saved.",
    });
    expect(setTaxTag).toHaveBeenCalledWith("u1", { transactionId: "t1" }, "work", { via: "page" });
    expect(revalidatePath).toHaveBeenCalledWith("/tax-pack");
  });

  it("untags a whole merchant, and says how many", async () => {
    vi.mocked(setTaxTag).mockResolvedValueOnce({ count: 4 });
    expect(await changeTag(null, form({ merchantKey: "masterclass", tag: "none" }))).toEqual({
      ok: true,
      message: "Saved for all 4.",
    });
    expect(setTaxTag).toHaveBeenCalledWith("u1", { merchantKey: "masterclass" }, null, {
      via: "page",
    });
  });

  it("refuses a tag that doesn't exist, and says what went wrong", async () => {
    expect(await changeTag(null, form({ transactionId: "t1", tag: "lottery" }))).toEqual({
      ok: false,
      message: "Pick a tag.",
    });
    expect(setTaxTag).not.toHaveBeenCalled();
    vi.mocked(setTaxTag).mockRejectedValueOnce(
      new TaxOrganizerError("That transaction isn't there anymore."),
    );
    expect(await changeTag(null, form({ transactionId: "gone", tag: "work" }))).toEqual({
      ok: false,
      message: "That transaction isn't there anymore.",
    });
  });
});
