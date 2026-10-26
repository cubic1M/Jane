import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Phone alerts end to end (docs/setup/push-alerts.md), against the test database: a device
// subscribes through /api/push, an alert reaches it, a device the push service says is gone is
// forgotten, and turning it off removes it. With the VAPID settings missing, as on the live site
// now, nothing subscribes or sends. The settings below are placeholders, not keys: the push
// service is never called (the sender is a stand-in).

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => (session.userId ? { id: session.userId } : null)),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));

import { db } from "@/lib/db";
import { DELETE, POST } from "@/app/api/push/route";
import { sendPush } from "./push";

const url = process.env.TEST_DATABASE_URL;
const PLACEHOLDERS = {
  VAPID_PUBLIC_KEY: "placeholder-public",
  VAPID_PRIVATE_KEY: "placeholder-private",
  VAPID_SUBJECT: "mailto:team@example.com",
};
const device = {
  endpoint: `https://fcm.googleapis.com/fcm/send/test-${crypto.randomUUID()}`,
  keys: { p256dh: "test-p256dh-key", auth: "test-auth-key" },
};
const request = (method: string, body: unknown) =>
  new Request("http://localhost/api/push", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const devicesOf = (userId: string) => db.pushSubscription.count({ where: { userId } });

describe.runIf(url)("phone alerts, from subscribing to sending", () => {
  let userId: string;
  beforeAll(async () => {
    userId = (await db.user.create({ data: { email: `push-${crypto.randomUUID()}@example.com` } }))
      .id;
    session.userId = userId;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: userId } });
  });

  it("does nothing without the VAPID settings (as live now)", async () => {
    for (const name of Object.keys(PLACEHOLDERS)) vi.stubEnv(name, "");
    expect((await POST(request("POST", device))).status).toBe(404);
    expect(await devicesOf(userId)).toBe(0);
    const send = vi.fn();
    expect(await sendPush(userId, { title: "t", body: "b", url: "/alerts" }, { send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("subscribes a device, sends to it, forgets it when gone, and turns off", async () => {
    for (const [name, value] of Object.entries(PLACEHOLDERS)) vi.stubEnv(name, value);

    // Turned on from Settings: the browser's subscription is saved for this person.
    expect((await POST(request("POST", device))).status).toBe(201);
    expect(await devicesOf(userId)).toBe(1);

    // An urgent alert: sent to that device, signed with the VAPID settings.
    const send = vi.fn(async () => ({}));
    const message = { title: "Jane", body: "Your rent is due tomorrow.", url: "/alerts" };
    expect(await sendPush(userId, message, { send })).toBe(1);
    expect(send).toHaveBeenCalledWith(
      { endpoint: device.endpoint, keys: device.keys },
      JSON.stringify(message),
      expect.objectContaining({
        vapidDetails: {
          subject: PLACEHOLDERS.VAPID_SUBJECT,
          publicKey: PLACEHOLDERS.VAPID_PUBLIC_KEY,
          privateKey: PLACEHOLDERS.VAPID_PRIVATE_KEY,
        },
      }),
    );

    // The push service says the device is gone: it's forgotten.
    const gone = vi.fn(async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    });
    expect(await sendPush(userId, message, { send: gone })).toBe(0);
    expect(await devicesOf(userId)).toBe(0);

    // Subscribed again, then turned off from Settings.
    expect((await POST(request("POST", device))).status).toBe(201);
    expect((await DELETE(request("DELETE", { endpoint: device.endpoint }))).status).toBe(200);
    expect(await devicesOf(userId)).toBe(0);
  });
});
