import { randomBytes } from "node:crypto";
import type { PlaidApi } from "plaid";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: { plaidItems: { findFirst: vi.fn(), deleteMany: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => scoped) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/evidence/orphans", () => ({ removeOrphans: vi.fn(), forgetSince: vi.fn() }));
vi.mock("@/lib/jane-agent/fresh-start", () => ({ markFreshStartIfEmpty: vi.fn() }));
vi.mock("@/lib/jane-agent/primer-cache", () => ({ forgetPrimer: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { forgetSince, removeOrphans } from "@/lib/evidence/orphans";
import { markFreshStartIfEmpty } from "@/lib/jane-agent/fresh-start";
import { removePlaidItem } from "./remove";

const itemRemove = vi.fn();
const api = { itemRemove } as unknown as PlaidApi;

describe("removing a linked bank", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    scoped.plaidItems.findFirst.mockReset().mockResolvedValue({
      id: "item_1",
      accessTokenEncrypted: encrypt("access-sandbox-made-up"),
      institutionName: "Bank",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    scoped.plaidItems.deleteMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(logAudit).mockReset();
    vi.mocked(removeOrphans)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.mocked(forgetSince)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.mocked(markFreshStartIfEmpty)
      .mockReset()
      .mockResolvedValue(undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes the audit line and runs every clean-up even when one of them fails", async () => {
    vi.mocked(removeOrphans).mockRejectedValue(new Error("orphans failed"));
    await expect(removePlaidItem("user_1", "item_1", "user_disconnected", { api })).resolves.toBe(
      undefined,
    );
    expect(scoped.plaidItems.deleteMany).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "user_1" },
      "item_removed",
      { type: "plaid_item", id: "item_1" },
      expect.objectContaining({ reason: "user_disconnected" }),
    );
    expect(forgetSince).toHaveBeenCalledTimes(1);
    expect(markFreshStartIfEmpty).toHaveBeenCalledTimes(1);
  });

  it("runs the clean-ups even when the audit write fails, and still reports the failure", async () => {
    vi.mocked(logAudit).mockRejectedValueOnce(new Error("audit down"));
    await expect(removePlaidItem("user_1", "item_1", "user_disconnected", { api })).rejects.toThrow(
      "audit down",
    );
    expect(removeOrphans).toHaveBeenCalledTimes(1);
    expect(forgetSince).toHaveBeenCalledTimes(1);
    expect(markFreshStartIfEmpty).toHaveBeenCalledTimes(1);
  });
});
