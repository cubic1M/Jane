import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({ plaidItems: { findFirst: async () => ({ id: "item1" }) } }),
}));
vi.mock("@/lib/plaid/sync", async (original) => {
  const { PlaidRequestError } = await import("@/lib/plaid/client");
  return {
    ...(await original<typeof import("@/lib/plaid/sync")>()),
    syncItem: vi.fn(async () => {
      throw new PlaidRequestError("ITEM_LOGIN_REQUIRED", 400);
    }),
  };
});

import { bankNotices } from "@/lib/plaid/bank-status";
import { refreshBank } from "./actions";

// Home and Connect call it "Sign in again"; Settings' button and its refresh message said
// "Reconnect", so the student looked for a button by a name the other pages never used
// (debug 3, 11-16).
describe("a bank that needs a sign-in, from Settings", () => {
  it("names the same button Home and Connect show", async () => {
    const [notice] = bankNotices(
      [
        {
          id: "item1",
          name: "First Platypus Bank",
          status: "login_required",
          lastSyncedAt: new Date("2026-11-16T08:00:00Z"),
          reconnectBy: null,
          newAccountsAvailable: false,
          lastErrorCode: "ITEM_LOGIN_REQUIRED",
        },
      ],
      new Date("2026-11-16T10:00:00Z"),
    );
    const form = new FormData();
    form.set("itemId", "item1");
    const result = await refreshBank({ ok: false, message: "" }, form);
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain(`Press ${notice.action}.`);
    expect(result?.message).not.toContain("Reconnect");
  });
});
