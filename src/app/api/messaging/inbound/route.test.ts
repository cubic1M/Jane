import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/messaging/inbound", () => ({ handleInboundText: vi.fn(async () => "yes") }));

import { handleInboundText } from "@/lib/messaging/inbound";
import { POST } from "./route";

const post = (body: unknown, secret?: string) =>
  POST(
    new Request("https://app.example.com/api/messaging/inbound", {
      method: "POST",
      headers: secret ? { "sb-signing-secret": secret } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/messaging/inbound (spec step 78)", () => {
  beforeEach(() => vi.mocked(handleInboundText).mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("refuses everything when no webhook secret is set", async () => {
    expect((await post({ content: "YES" }, "anything")).status).toBe(401);
    expect(handleInboundText).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong sb-signing-secret", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "s3cret");
    expect((await post({ content: "YES" })).status).toBe(401);
    expect((await post({ content: "YES" }, "wrong")).status).toBe(401);
    expect(handleInboundText).not.toHaveBeenCalled();
  });

  it("passes a verified webhook on, and refuses bad bodies", async () => {
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "s3cret");
    const response = await post({ content: "YES", number: "+14155550142" }, "s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "yes" });
    expect(handleInboundText).toHaveBeenCalledWith({ content: "YES", number: "+14155550142" });
    expect((await post("not json", "s3cret")).status).toBe(400);
    expect((await post(null, "s3cret")).status).toBe(400);
    expect((await post("x".repeat(60_000), "s3cret")).status).toBe(413);
  });
});
