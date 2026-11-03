import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: {
    pushSubscriptions: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => scoped) }));

import { parseSubscription, pushEnabled, sendPush, vapidPublicKey } from "./push";

const KEYS = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:team@example.com",
};
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: {
    p256dh: "test-p256dh-key",
    auth: "test-auth-key",
  },
};

describe("the browsers' push services", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
  ])("accepts %s", (endpoint) => {
    expect(parseSubscription({ ...subscription, endpoint })?.endpoint).toBe(endpoint);
  });
});

describe("an address the two parsers read differently", () => {
  it.each([
    "https://evil.example%2Epush.apple.com/x",
    "https://evil.example%2epush.services.mozilla.com/x",
    "https://evil.example\\.push.apple.com/x",
    "https://FCM.googleapis.com/fcm/send/abc",
    " https://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "http://fcm.googleapis.com/x",
  ])("refuses %s", (endpoint) => {
    expect(parseSubscription({ ...subscription, endpoint })).toBeNull();
  });
});

describe("push setup", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off without all three VAPID settings", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(pushEnabled()).toBe(false);
    expect(vapidPublicKey()).toBeNull();
    for (const [k, v] of Object.entries(KEYS)) vi.stubEnv(k, v);
    expect(pushEnabled()).toBe(true);
    expect(vapidPublicKey()).toBe("pub");
  });
});

describe("parseSubscription", () => {
  it("accepts a browser's subscription", () => {
    expect(parseSubscription(subscription)).toEqual(subscription);
  });

  it.each([
    [null],
    [{ ...subscription, endpoint: "http://insecure.example/push" }],
    [{ ...subscription, endpoint: "not a url" }],
    // Any address but a browser's push service would make Jane post to it.
    [{ ...subscription, endpoint: "https://evil.example/push" }],
    [{ ...subscription, endpoint: "https://10.0.0.1/push" }],
    [{ ...subscription, endpoint: "https://fcm.googleapis.com.evil.example/push" }],
    [{ ...subscription, endpoint: "https://fcm.googleapis.com@evil.example/push" }],
    [{ ...subscription, endpoint: "https://x@fcm.googleapis.com/push" }],
    [{ ...subscription, endpoint: "https://fcm.googleapis.com:8443/push" }],
    [{ ...subscription, keys: { p256dh: "has spaces!", auth: "x" } }],
    [{ endpoint: subscription.endpoint }],
  ])("rejects %j", (value) => {
    expect(parseSubscription(value)).toBeNull();
  });
});

describe("sendPush", () => {
  const send = vi.fn();
  beforeEach(() => {
    for (const [k, v] of Object.entries(KEYS)) vi.stubEnv(k, v);
    send.mockReset();
    scoped.pushSubscriptions.findMany.mockReset().mockResolvedValue([
      { id: "s1", endpoint: "https://fcm.googleapis.com/fcm/send/1", p256dh: "p", auth: "a" },
      { id: "s2", endpoint: "https://fcm.googleapis.com/fcm/send/2", p256dh: "p", auth: "a" },
    ]);
    scoped.pushSubscriptions.deleteMany.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const message = { title: "Possible double charge", body: "b", url: "/jane#alerts" };

  it("sends to every device with the VAPID keys", async () => {
    send.mockResolvedValue({});
    expect(await sendPush("u1", message, { send })).toBe(2);
    expect(send).toHaveBeenCalledWith(
      { endpoint: "https://fcm.googleapis.com/fcm/send/1", keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(message),
      expect.objectContaining({
        vapidDetails: { subject: KEYS.VAPID_SUBJECT, publicKey: "pub", privateKey: "priv" },
      }),
    );
  });

  it("forgets devices the push service says are gone", async () => {
    send.mockRejectedValueOnce({ statusCode: 410 }).mockResolvedValueOnce({});
    expect(await sendPush("u1", message, { send })).toBe(1);
    expect(scoped.pushSubscriptions.deleteMany).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("never posts to an address saved before the check, and forgets it", async () => {
    scoped.pushSubscriptions.findMany.mockResolvedValue([
      { id: "old1", endpoint: "https://evil.example/hook", p256dh: "p", auth: "a" },
      { id: "old2", endpoint: "https://evil.example%2Epush.apple.com/x", p256dh: "p", auth: "a" },
      { id: "s1", endpoint: "https://fcm.googleapis.com/fcm/send/1", p256dh: "p", auth: "a" },
    ]);
    send.mockResolvedValue({});
    expect(await sendPush("u1", message, { send })).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect(scoped.pushSubscriptions.deleteMany).toHaveBeenCalledWith({ where: { id: "old1" } });
    expect(scoped.pushSubscriptions.deleteMany).toHaveBeenCalledWith({ where: { id: "old2" } });
  });

  it("gives up on a push service that never answers", async () => {
    send.mockResolvedValue({});
    await sendPush("u1", message, { send });
    expect(send.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it("does nothing when push isn't set up", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await sendPush("u1", message, { send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
