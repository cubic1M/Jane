import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/prior-return", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prior-return")>()),
  confirmPriorReturn: vi.fn(),
  dismissPriorReturn: vi.fn(),
}));
vi.mock("@/lib/tax-amendment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-amendment")>()),
  prepareAmendment: vi.fn(),
  signAmendment: vi.fn(),
}));

import { PriorReturnError, confirmPriorReturn, dismissPriorReturn } from "@/lib/prior-return";
import { AmendmentError, prepareAmendment, signAmendment } from "@/lib/tax-amendment";
import { fieldsFrom, returnAction } from "./actions";

// Spec step 172: confirming a reading, preparing an amended return, and the review and
// signature the person must give.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("last year's return actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only the fields that were filled in", () => {
    expect(fieldsFrom(form({ taxYear: "2025", agi: " 85,000 ", refund: "", other: "x" }))).toEqual({
      taxYear: "2025",
      agi: "85,000",
    });
  });

  it("confirms with the typed fields, or says it isn't a return", async () => {
    expect(
      await returnAction(null, form({ intent: "confirm", id: "r1", taxYear: "2025" })),
    ).toEqual({
      ok: true,
      message: "Confirmed. Jane is checking it against your accounts.",
    });
    expect(confirmPriorReturn).toHaveBeenCalledWith("u1", "r1", { fields: { taxYear: "2025" } });
    expect(await returnAction(null, form({ intent: "dismiss", id: "r1" }))).toMatchObject({
      ok: true,
    });
    expect(dismissPriorReturn).toHaveBeenCalledWith("u1", "r1");
  });

  it("prepares the amended return, and signs only with the review and the name", async () => {
    expect(await returnAction(null, form({ intent: "prepare", year: "2025" }))).toMatchObject({
      ok: true,
    });
    expect(prepareAmendment).toHaveBeenCalledWith("u1", 2025, { via: "page" });
    await returnAction(
      null,
      form({ intent: "sign", year: "2025", reviewed: "on", signature: "Alex Rivera" }),
    );
    expect(signAmendment).toHaveBeenCalledWith("u1", {
      year: 2025,
      reviewed: true,
      signature: "Alex Rivera",
    });
    await returnAction(null, form({ intent: "sign", year: "2025", signature: "Alex Rivera" }));
    expect(signAmendment).toHaveBeenLastCalledWith("u1", {
      year: 2025,
      reviewed: false,
      signature: "Alex Rivera",
    });
  });

  it("says what's wrong", async () => {
    vi.mocked(confirmPriorReturn).mockRejectedValueOnce(
      new PriorReturnError("Give the tax year the return is for."),
    );
    expect(await returnAction(null, form({ intent: "confirm", id: "r1" }))).toEqual({
      ok: false,
      message: "Give the tax year the return is for.",
    });
    vi.mocked(signAmendment).mockRejectedValueOnce(new AmendmentError("Sign with your full name."));
    expect(await returnAction(null, form({ intent: "sign", year: "2025" }))).toEqual({
      ok: false,
      message: "Sign with your full name.",
    });
    expect(await returnAction(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});
