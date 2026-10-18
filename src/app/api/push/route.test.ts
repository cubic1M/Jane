import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  saveSubscription: vi.fn(),
  removeSubscription: vi.fn(),
}));

import { removeSubscription, saveSubscription } from "@/lib/push";
import { getCurrentUser } from "@/lib/session";
import { DELETE, POST } from "./route";

const call = (method: "POST" | "DELETE", body: unknown) =>
  (method === "POST" ? POST : DELETE)(
    new Request("http://localhost/api/push", { method, body: JSON.stringify(body) }),
  );
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "test-p256dh-key", auth: "test-auth-key" },
};

describe("/api/push", () => {
  beforeEach(() => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:team@example.com");
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(saveSubscription).mockReset();
    vi.mocked(removeSubscription).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await call("POST", subscription)).status).toBe(401);
  });

  it("is off without VAPID keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect((await call("POST", subscription)).status).toBe(404);
    expect(saveSubscription).not.toHaveBeenCalled();
  });

  it("saves a valid subscription for the signed-in person", async () => {
    expect((await call("POST", subscription)).status).toBe(201);
    expect(saveSubscription).toHaveBeenCalledWith("u1", subscription);
    expect((await call("POST", { endpoint: "nope" })).status).toBe(400);
  });

  it("removes this device's subscription", async () => {
    expect((await call("DELETE", { endpoint: subscription.endpoint })).status).toBe(200);
    expect(removeSubscription).toHaveBeenCalledWith("u1", subscription.endpoint);
  });
});
