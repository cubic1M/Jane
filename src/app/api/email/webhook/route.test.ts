import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/digest/resend-webhook", async (original) => ({
  ...(await original<typeof import("@/lib/digest/resend-webhook")>()),
  recordEmailEvent: vi.fn(async () => "opened"),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { recordEmailEvent } from "@/lib/digest/resend-webhook";
import { POST } from "./route";

const SECRET = `whsec_${Buffer.from("route test key").toString("base64")}`;

function request(body: string, sign = true) {
  const id = "msg_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://app.example.com/api/email/webhook", {
    method: "POST",
    body,
    headers: sign
      ? { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` }
      : {},
  });
}

beforeEach(() => {
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
  vi.mocked(recordEmailEvent).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/email/webhook", () => {
  const body = JSON.stringify({ type: "email.opened", data: { email_id: "re_1" } });

  it("records a signed delivery", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, result: "opened" });
    expect(recordEmailEvent).toHaveBeenCalledWith(JSON.parse(body));
  });

  it("refuses an unsigned delivery, or any when no secret is set, before reading it", async () => {
    expect((await POST(request(body, false))).status).toBe(400);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await POST(request(body))).status).toBe(400);
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });

  it("refuses a signed body that isn't JSON", async () => {
    expect((await POST(request("not json"))).status).toBe(400);
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });
});
