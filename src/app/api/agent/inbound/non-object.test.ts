import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/run", () => ({ handleReply: vi.fn(async () => "acted") }));
vi.mock("@/lib/digest/resend-webhook", () => ({ verifyResendSignature: () => true }));

import { handleReply } from "@/lib/agent/run";
import { POST } from "./route";

const post = (body: string, headers: Record<string, string>) =>
  POST(new Request("https://app.example.com/api/agent/inbound", { method: "POST", headers, body }));

describe("POST /api/agent/inbound, with JSON that isn't an object", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["null", "5", '"text"', "[]"])("answers 400 to %s from either sender", async (body) => {
    vi.stubEnv("AGENT_INBOUND_SECRET", "s3cret");
    expect((await post(body, { authorization: "Bearer s3cret" })).status).toBe(400);
    expect((await post(body, { "svix-signature": "v1,signed" })).status).toBe(400);
    expect(handleReply).not.toHaveBeenCalled();
  });
});
