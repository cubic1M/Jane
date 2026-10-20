import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/accountant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accountant")>()),
  createAccountantLink: vi.fn(async () => ({
    url: "https://jane.test/accountant/abc",
    expiresOn: "2026-11-01",
  })),
  revokeAccountantLink: vi.fn(),
  markNotesSeen: vi.fn(),
}));

import {
  AccountantError,
  createAccountantLink,
  markNotesSeen,
  revokeAccountantLink,
} from "@/lib/accountant";
import { accountantAction } from "./actions";

// Spec step 222: making a link (the URL comes back once), revoking it, marking answers read.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("accountant actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes a link and returns its URL once, revokes, and marks read", async () => {
    const made = await accountantAction(
      null,
      form({ intent: "create", label: "Dana", days: "14" }),
    );
    expect(made).toMatchObject({ ok: true, url: "https://jane.test/accountant/abc" });
    expect(made!.message).toContain("stops working on Nov 1, 2026");
    expect(createAccountantLink).toHaveBeenCalledWith("u1", { label: "Dana", days: 14 });
    expect(await accountantAction(null, form({ intent: "revoke", id: "l1" }))).toEqual({
      ok: true,
      message: "Revoked. That link no longer works.",
    });
    expect(revokeAccountantLink).toHaveBeenCalledWith("u1", "l1");
    expect(await accountantAction(null, form({ intent: "seen" }))).toMatchObject({ ok: true });
    expect(markNotesSeen).toHaveBeenCalledWith("u1");
  });

  it("says what's wrong", async () => {
    vi.mocked(createAccountantLink).mockRejectedValueOnce(new AccountantError("Say who it's for."));
    expect(await accountantAction(null, form({ intent: "create", label: "", days: "14" }))).toEqual(
      {
        ok: false,
        message: "Say who it's for.",
      },
    );
    expect(await accountantAction(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});
