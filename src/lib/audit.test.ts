import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { auditLog: { create } } }));

import { logAudit, SYSTEM_ACTOR } from "./audit";

describe("logAudit", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({});
  });

  it("writes actor, event, target and metadata to audit_log", async () => {
    await logAudit(
      { type: "user", id: "user_1" },
      "user_signed_in",
      { type: "user", id: "user_1" },
      { provider: "google" },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: "user",
        actorId: "user_1",
        event: "user_signed_in",
        targetType: "user",
        targetId: "user_1",
        metadata: { provider: "google" },
      },
    });
  });

  it("allows system events without a target or metadata", async () => {
    await logAudit(SYSTEM_ACTOR, "user_signed_up", null);

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: "system",
        actorId: null,
        event: "user_signed_up",
        targetType: null,
        targetId: null,
        metadata: {},
      },
    });
  });

  it("throws when the write fails, so a missing audit record is never silent", async () => {
    create.mockRejectedValue(new Error("db down"));

    await expect(
      logAudit(SYSTEM_ACTOR, "user_signed_in", { type: "user", id: "user_1" }),
    ).rejects.toThrow("db down");
  });
});
