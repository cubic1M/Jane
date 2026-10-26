import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany, deleteAccounts } = vi.hoisted(() => ({
  updateMany: vi.fn(),
  deleteAccounts: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
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
    updateMany.mockReset();
    deleteAccounts.mockReset();
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
    await plan({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION" });

    expect(scopedFor).toHaveBeenCalledWith("user_1", client);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1" },
      data: { status: "login_required" },
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
    await plan({ webhook_type: "ITEM", webhook_code: "PENDING_DISCONNECT" });
    expect(updateMany.mock.calls.map((c) => c[0].data)).toEqual([
      { status: "login_required" },
      { status: "login_required" },
    ]);
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
