import { beforeEach, describe, expect, it, vi } from "vitest";

const webhooks = vi.hoisted(() => ({
  firstDelivery: vi.fn(),
  forgetDelivery: vi.fn(async () => {}),
  planWebhook: vi.fn(),
  syncFromWebhook: vi.fn(async () => {}),
}));
const verify = vi.hoisted(() => vi.fn());

vi.mock("@/lib/plaid/webhooks", () => webhooks);
vi.mock("@/lib/plaid/webhook-verify", () => ({ verifyPlaidWebhook: verify }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (run: () => unknown) => run(),
}));

import { POST } from "./route";

const raw = JSON.stringify({ webhook_type: "ITEM", webhook_code: "USER_ACCOUNT_REVOKED" });
const call = () =>
  POST(new Request("https://jane.test/api/plaid/webhook", { method: "POST", body: raw }));

beforeEach(() => {
  vi.clearAllMocks();
  verify.mockResolvedValue(true);
  webhooks.firstDelivery.mockResolvedValue(true);
  webhooks.planWebhook.mockResolvedValue(null);
});

describe("POST /api/plaid/webhook", () => {
  it("reads nothing without a good signature", async () => {
    verify.mockResolvedValue(false);
    expect((await call()).status).toBe(401);
    expect(webhooks.firstDelivery).not.toHaveBeenCalled();
  });

  it("acknowledges a repeat and does nothing", async () => {
    webhooks.firstDelivery.mockResolvedValue(false);
    expect((await call()).status).toBe(200);
    expect(webhooks.planWebhook).not.toHaveBeenCalled();
  });

  it("syncs when the plan says so", async () => {
    webhooks.planWebhook.mockResolvedValue({ sync: true, itemId: "i1" });
    expect((await call()).status).toBe(200);
    expect(webhooks.syncFromWebhook).toHaveBeenCalledWith("i1");
  });

  // Written first and acted on after: a failure here left Plaid's retry looking like a repeat, so
  // a revoked account's data stayed.
  it("lets Plaid's retry count when acting on it fails", async () => {
    webhooks.planWebhook.mockRejectedValue(new Error("database down"));
    await expect(call()).rejects.toThrow("database down");
    expect(webhooks.forgetDelivery).toHaveBeenCalledWith(raw);
  });
});
