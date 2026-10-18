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
      { id: "s1", endpoint: "https://push.example/1", p256dh: "p", auth: "a" },
      { id: "s2", endpoint: "https://push.example/2", p256dh: "p", auth: "a" },
    ]);
    scoped.pushSubscriptions.deleteMany.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const message = { title: "Possible double charge", body: "b", url: "/alerts" };

  it("sends to every device with the VAPID keys", async () => {
    send.mockResolvedValue({});
    expect(await sendPush("u1", message, { send })).toBe(2);
    expect(send).toHaveBeenCalledWith(
      { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } },
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

  it("does nothing when push isn't set up", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await sendPush("u1", message, { send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
