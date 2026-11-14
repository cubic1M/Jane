import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tax-filing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-filing")>()),
  startReturn: vi.fn(),
  signReturn: vi.fn(),
}));

import { FilingError, signReturn, startReturn } from "@/lib/tax-filing";
import { fileAction } from "./actions";
import { form } from "@/lib/__fixtures__/form";

// Spec step 126: the filing page's start and sign.

describe("fileAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts the return for the signed-in person", async () => {
    expect(await fileAction(null, form({ intent: "start" }))).toEqual({
      ok: true,
      message: "Your return is ready to review.",
    });
    expect(startReturn).toHaveBeenCalledWith("u1", { via: "page" });
  });

  it("passes the review tick and the signature to be checked", async () => {
    await fileAction(
      null,
      form({ intent: "sign", year: "2026", reviewed: "on", signature: "Alex Rivera" }),
    );
    expect(signReturn).toHaveBeenCalledWith("u1", {
      year: 2026,
      reviewed: true,
      signature: "Alex Rivera",
    });
    await fileAction(null, form({ intent: "sign", year: "2026", signature: "Alex Rivera" }));
    expect(signReturn).toHaveBeenLastCalledWith("u1", {
      year: 2026,
      reviewed: false,
      signature: "Alex Rivera",
    });
  });

  it("says what's wrong", async () => {
    vi.mocked(signReturn).mockRejectedValueOnce(
      new FilingError("Tick that you've reviewed the return first."),
    );
    expect(await fileAction(null, form({ intent: "sign", year: "2026" }))).toEqual({
      ok: false,
      message: "Tick that you've reviewed the return first.",
    });
  });
});
