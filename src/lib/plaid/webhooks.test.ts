import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({ plaidItems: { updateMany } })),
}));

import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { planWebhook } from "./webhooks";

const findUnique = vi.fn();
const client = { plaidItem: { findUnique } } as unknown as PrismaClient;
const plan = (body: Record<string, unknown>) =>
  planWebhook({ item_id: "plaid_item_1", ...body }, { client });

describe("planWebhook", () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue({ id: "item_1", userId: "user_1" });
    updateMany.mockReset();
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
      data: { status: "active" },
    });
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
