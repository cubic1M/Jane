import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/run", () => ({ handleReply: vi.fn(async () => "acted") }));

import { handleReply } from "@/lib/agent/run";
import { POST } from "./route";

const post = (body: unknown, auth?: string) =>
  POST(
    new Request("https://app.example.com/api/agent/inbound", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/agent/inbound", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses anything without the shared secret, and everything when none is set", async () => {
    expect((await post({ to: "x" })).status).toBe(401);
    vi.stubEnv("AGENT_INBOUND_SECRET", "s3cret");
    expect((await post({ to: "x" }, "Bearer wrong")).status).toBe(401);
    expect(handleReply).not.toHaveBeenCalled();
  });

  it("passes a reply to the agent", async () => {
    vi.stubEnv("AGENT_INBOUND_SECRET", "s3cret");
    const response = await post(
      { to: "reply+abc@x", from: "support@co.example", subject: "Re", text: "Refunded." },
      "Bearer s3cret",
    );
    expect(response.status).toBe(200);
    expect(handleReply).toHaveBeenCalledWith("reply+abc@x", {
      from: "support@co.example",
      subject: "Re",
      body: "Refunded.",
    });
    expect((await post("not json", "Bearer s3cret")).status).toBe(400);
    expect((await post({ from: "x" }, "Bearer s3cret")).status).toBe(400);
  });
});
