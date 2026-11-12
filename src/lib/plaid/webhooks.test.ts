import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, deleteAccounts, recordOpsEvent } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  deleteAccounts: vi.fn(),
  recordOpsEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ops-alerts", () => ({ recordOpsEvent }));
vi.mock("@/lib/evidence/orphans", () => ({ forgetSince: vi.fn(), removeOrphans: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({
    plaidItems: { updateMany },
    accounts: { deleteMany: deleteAccounts },
  })),
}));

import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { planWebhook } from "./webhooks";

const findUnique = vi.fn();
const client = { plaidItem: { findUnique } } as unknown as PrismaClient;
const NOW = new Date("2026-10-26T08:00:00Z");
const plan = (body: Record<string, unknown>) =>
  planWebhook({ item_id: "plaid_item_1", ...body }, { client, now: NOW });

describe("planWebhook", () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue({ id: "item_1", userId: "user_1" });
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    recordOpsEvent.mockReset();
    deleteAccounts.mockReset().mockResolvedValue({ count: 1 });
  });

  it.each(["SYNC_UPDATES_AVAILABLE", "RECURRING_TRANSACTIONS_UPDATE", "DEFAULT_UPDATE"])(
    "syncs on TRANSACTIONS %s",
    async (code) => {
      expect(await plan({ webhook_type: "TRANSACTIONS", webhook_code: code })).toEqual({
        itemId: "item_1",
        sync: true,
      });
    },
  );

  it.each(["LIABILITIES", "HOLDINGS"])("syncs when the bank's %s details change", async (type) => {
    expect(await plan({ webhook_type: type, webhook_code: "DEFAULT_UPDATE" })).toEqual({
      itemId: "item_1",
      sync: true,
    });
  });

  it("marks the item for reconnecting when the bank needs a new sign-in", async () => {
    await plan({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      error: { error_code: "ITEM_LOGIN_REQUIRED" },
    });

    expect(scopedFor).toHaveBeenCalledWith("user_1", client);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", status: { not: "login_required" } },
      data: { status: "login_required" },
    });
    // The founders' daily email counts it, with the code and no one's id in the row.
    expect(recordOpsEvent).toHaveBeenCalledWith(
      "bank_connection_broken",
      expect.objectContaining({ code: "ITEM_LOGIN_REQUIRED", userId: "user_1" }),
    );
  });

  it("counts a broken connection once: a repeat of an item already waiting isn't news", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await plan({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      error: { error_code: "ITEM_LOGIN_REQUIRED" },
    });
    expect(recordOpsEvent).not.toHaveBeenCalled();
  });

  // Plaid: the Item is disconnected 7 days later, and update mode before then resolves it. Until
  // then it works, so it keeps syncing (status stays active) and the person gets a date.
  it.each([
    ["PENDING_DISCONNECT", { disconnect_time: "2026-11-02T08:00:00Z" }],
    ["PENDING_EXPIRATION", { consent_expiration_time: "2026-11-02T08:00:00Z" }],
  ])("asks for a sign-in by Plaid's date on %s, and keeps syncing", async (code, extra) => {
    expect(await plan({ webhook_type: "ITEM", webhook_code: code, ...extra })).toEqual({
      itemId: "item_1",
      sync: false,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1" },
      data: { reconnectBy: new Date("2026-11-02T08:00:00Z") },
    });
    expect(updateMany.mock.calls.some((c) => "status" in c[0].data)).toBe(false);
    expect(recordOpsEvent).toHaveBeenCalledWith(
      "bank_disconnect_pending",
      expect.objectContaining({ code }),
    );
  });

  it("gives a pending disconnect without a time 7 days", async () => {
    await plan({ webhook_type: "ITEM", webhook_code: "PENDING_DISCONNECT" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1" },
      data: { reconnectBy: new Date("2026-11-02T08:00:00Z") },
    });
  });

  it("marks the item active again and syncs when the login is repaired", async () => {
    expect(await plan({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED" })).toEqual({
      itemId: "item_1",
      sync: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1" },
      data: { status: "active", lastErrorCode: null, lastErrorAt: null },
    });
  });

  it("asks for a sign-in when the person took access back", async () => {
    expect(
      await plan({
        webhook_type: "ITEM",
        webhook_code: "USER_PERMISSION_REVOKED",
        error: { error_code: "USER_PERMISSION_REVOKED" },
      }),
    ).toEqual({ itemId: "item_1", sync: false });
    expect(updateMany.mock.calls.map((c) => c[0].data)).toEqual([{ status: "login_required" }]);
    expect(recordOpsEvent).toHaveBeenCalledWith(
      "bank_connection_broken",
      expect.objectContaining({ code: "USER_PERMISSION_REVOKED" }),
    );
  });

  it("keeps any other item error, to say why the data is old", async () => {
    expect(
      await plan({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        error: { error_code: "INSTITUTION_DOWN" },
      }),
    ).toEqual({ itemId: "item_1", sync: false });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1" },
      data: { lastErrorCode: "INSTITUTION_DOWN", lastErrorAt: NOW },
    });
  });

  it("flags new accounts to share, and deletes an account the person stopped sharing", async () => {
    await plan({ webhook_type: "ITEM", webhook_code: "NEW_ACCOUNTS_AVAILABLE" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1" },
      data: { newAccountsAvailable: true },
    });
    await plan({
      webhook_type: "ITEM",
      webhook_code: "USER_ACCOUNT_REVOKED",
      account_id: "plaid_acc_9",
    });
    expect(deleteAccounts).toHaveBeenCalledWith({
      where: { itemId: "item_1", plaidAccountId: "plaid_acc_9" },
    });
  });

  it("sets states, never toggles them: the same webhook twice leaves the same result", async () => {
    const body = { webhook_type: "ITEM", webhook_code: "NEW_ACCOUNTS_AVAILABLE" };
    await plan(body);
    await plan(body);
    expect(updateMany.mock.calls[0]).toEqual(updateMany.mock.calls[1]);
  });

  it("ignores unknown items and events it doesn't use", async () => {
    expect(await plan({ webhook_type: "AUTH", webhook_code: "AUTOMATICALLY_VERIFIED" })).toBeNull();
    findUnique.mockResolvedValue(null);
    expect(
      await plan({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" }),
    ).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
