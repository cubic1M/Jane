import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    robinhoodConnections: {
      findFirst: async () => ({
        id: "c1",
        secretsEncrypted: "sealed",
        clientId: "client",
        createdAt: new Date("2026-10-01"),
      }),
      deleteMany: async () => ({ count: 1 }),
    },
  }),
}));
vi.mock("@/config/robinhood", async (original) => ({
  ...(await original<typeof import("@/config/robinhood")>()),
  robinhoodOffered: () => true,
}));
vi.mock("@/lib/robinhood/secrets", () => ({
  openSecrets: () => ({ accessToken: "a", refreshToken: "r", accountKey: "k" }),
  sealSecrets: vi.fn(),
  newAccountKey: vi.fn(),
}));
vi.mock("@/lib/robinhood/oauth", () => ({ revokeTokens: vi.fn(async () => true) }));
vi.mock("@/lib/evidence/orphans", () => ({
  removeOrphans: vi.fn(async () => {
    throw new Error("cleanup failed");
  }),
  forgetSince: vi.fn(),
}));
vi.mock("@/lib/jane-agent/primer-cache", () => ({ forgetPrimer: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { forgetSince } from "@/lib/evidence/orphans";
import { removeConnection } from "@/lib/robinhood/connection";
import { revokeTokens } from "@/lib/robinhood/oauth";

describe("removing a Robinhood connection when tidying up afterwards fails", () => {
  // The stored tokens are already deleted: no later try could end them at Robinhood.
  it("still ends the connection there, and records it", async () => {
    await expect(removeConnection("u1", "user_disconnected")).rejects.toThrow("cleanup failed");
    expect(revokeTokens).toHaveBeenCalledWith("client", ["r", "a"]);
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "robinhood_disconnected",
      { type: "robinhood_connection", id: "c1" },
      expect.objectContaining({ ended_at_robinhood: true }),
    );
  });

  it("forgets what was worked out since before the connection is deleted, and still ends it when the sweep fails", async () => {
    vi.mocked(forgetSince).mockClear();
    await expect(removeConnection("u1", "user_disconnected")).rejects.toThrow("cleanup failed");
    expect(forgetSince).toHaveBeenCalledTimes(1);
  });

  it("keeps the connection and its tokens, and ends nothing, when forgetting what it brought in fails", async () => {
    vi.mocked(forgetSince).mockRejectedValueOnce(new Error("forget failed"));
    vi.mocked(revokeTokens).mockClear();
    await expect(removeConnection("u1", "user_disconnected")).rejects.toThrow("forget failed");
    expect(revokeTokens).not.toHaveBeenCalled();
  });
});
