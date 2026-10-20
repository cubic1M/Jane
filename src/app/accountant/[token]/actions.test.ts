import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/accountant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accountant")>()),
  answerByToken: vi.fn(),
}));

import { AccountantError, answerByToken } from "@/lib/accountant";
import { answerAction } from "./actions";

// Spec step 222: the accountant answers from the page; the token is the only credential.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("accountant answer action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the token, the question and the answer on", async () => {
    expect(
      await answerAction(
        null,
        form({ token: "tok", questionKey: "side_kind", name: "Dana", body: "Business." }),
      ),
    ).toEqual({ ok: true, message: "Sent. Thank you." });
    expect(answerByToken).toHaveBeenCalledWith("tok", {
      questionKey: "side_kind",
      name: "Dana",
      body: "Business.",
    });
    await answerAction(null, form({ token: "tok", name: "Dana", body: "A note." }));
    expect(answerByToken).toHaveBeenLastCalledWith("tok", {
      questionKey: null,
      name: "Dana",
      body: "A note.",
    });
  });

  it("says when the link has ended", async () => {
    vi.mocked(answerByToken).mockRejectedValueOnce(
      new AccountantError("This link isn't available any more."),
    );
    expect(await answerAction(null, form({ token: "tok", name: "D", body: "x" }))).toEqual({
      ok: false,
      message: "This link isn't available any more.",
    });
  });
});
