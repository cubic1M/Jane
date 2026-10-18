import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The route uses the app's database client; here it's the test database.
vi.mock("@/lib/db", async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  return {
    db: new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
    }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { personWithFindings, verifiedNumber, fakePhone } from "@/lib/__fixtures__/texts";
import { db as client } from "@/lib/db";
import { sendPlanText } from "@/lib/messaging/texts";
import { POST } from "./route";

// POST /api/messaging/inbound (spec step 78) against a real database.
const url = process.env.TEST_DATABASE_URL;
const SECRET = "test-webhook-secret";

const post = (body: unknown, secret?: string) =>
  POST(
    new Request("https://app.example.com/api/messaging/inbound", {
      method: "POST",
      headers: secret ? { "sb-signing-secret": secret } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

// Sendblue's "receive" payload, with the fields we read.
const received = (number: string, content: string, handle = randomBytes(8).toString("hex")) => ({
  accountEmail: "team@example.com",
  content,
  is_outbound: false,
  status: "RECEIVED",
  message_handle: handle,
  from_number: number,
  number,
  to_number: "+15125550100",
  group_id: "",
  service: "iMessage",
});

describe.runIf(url)("POST /api/messaging/inbound", () => {
  const created: string[] = [];

  async function personWithPlan() {
    const userId = await personWithFindings(client);
    created.push(userId);
    const phone = await verifiedNumber(client, userId);
    expect(await sendPlanText(userId, { client })).toBe("sent");
    return { userId, phone };
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("refuses anything without Sendblue's secret", async () => {
    const { userId, phone } = await personWithPlan();
    expect((await post(received(phone, "YES"))).status).toBe(401);
    expect((await post(received(phone, "YES"), "wrong-secret")).status).toBe(401);
    expect(await client.decision.count({ where: { userId } })).toBe(0);
    expect(await client.textMessage.count({ where: { userId, direction: "inbound" } })).toBe(0);
    expect((await post("not json", SECRET)).status).toBe(400);
    expect((await post([1, 2], SECRET)).status).toBe(400);
  });

  it("ignores numbers it doesn't know, and unverified ones, without answering", async () => {
    const response = await post(received(fakePhone(), "YES"), SECRET);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "unknown_number" });

    const userId = await personWithFindings(client);
    created.push(userId);
    const phone = await verifiedNumber(client, userId);
    await client.textSetting.update({ where: { userId }, data: { verifiedAt: null } });
    expect(await (await post(received(phone, "YES"), SECRET)).json()).toEqual({
      result: "unknown_number",
    });
    expect(await client.textMessage.count({ where: { userId } })).toBe(0);
  });

  it("YES approves only that person's items, once", async () => {
    const me = await personWithPlan();
    const other = await personWithPlan();

    const response = await post(received(me.phone, "YES"), SECRET);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "yes" });
    const mine = await client.decision.findMany({ where: { userId: me.userId } });
    expect(mine).toHaveLength(2);
    expect(mine.every((d) => d.source === "text")).toBe(true);
    expect(await client.decision.count({ where: { userId: other.userId } })).toBe(0);

    // A second YES finds nothing open.
    await post(received(me.phone, "YES"), SECRET);
    expect(await client.decision.count({ where: { userId: me.userId } })).toBe(2);
  });

  it("handles a repeated webhook once", async () => {
    const { userId, phone } = await personWithPlan();
    const payload = received(phone, "1", "same-handle-" + randomBytes(4).toString("hex"));
    expect(await (await post(payload, SECRET)).json()).toEqual({ result: "numbers" });
    expect(await (await post(payload, SECRET)).json()).toEqual({ result: "duplicate" });
    expect(await client.decision.count({ where: { userId } })).toBe(1);
  });

  it("records delivery updates for texts Jane sent, never going backwards", async () => {
    const { userId } = await personWithPlan();
    const plan = await client.textMessage.findFirstOrThrow({ where: { userId, kind: "plan" } });
    await client.textMessage.update({
      where: { id: plan.id },
      data: { status: "sent", providerId: `handle-${plan.id}` },
    });
    const status = (s: string) =>
      post({ is_outbound: true, status: s, message_handle: `handle-${plan.id}` }, SECRET);
    expect(await (await status("DELIVERED")).json()).toEqual({ result: "status" });
    await status("SENT");
    expect((await client.textMessage.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe(
      "delivered",
    );
  });

  it("ignores group chats", async () => {
    const { userId, phone } = await personWithPlan();
    expect(
      await (await post({ ...received(phone, "YES"), group_id: "group-1" }, SECRET)).json(),
    ).toEqual({ result: "ignored" });
    expect(await client.decision.count({ where: { userId } })).toBe(0);
  });
});
