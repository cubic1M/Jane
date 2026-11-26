import { describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create } } }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    throw new Error("outside a request scope");
  }),
}));

import { logAudit, SYSTEM_ACTOR } from "./audit";

describe("an access-log entry's outcome", () => {
  it("is the event's own, whatever the caller's details say", async () => {
    await logAudit(SYSTEM_ACTOR, "sign_in_failed", null, { outcome: "success", ip: "x" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "failure", ip: null }),
      }),
    });
  });
});
