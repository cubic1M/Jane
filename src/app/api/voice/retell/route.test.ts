import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleCallResult = vi.fn(async () => "acted");
vi.mock("@/lib/voice/calls", () => ({ handleCallResult }));

const post = async (body: string, key = "key") => {
  const { POST } = await import("./route");
  const at = Date.now();
  const digest = createHmac("sha256", key).update(`${body}${at}`).digest("hex");
  return POST(
    new Request("http://x.test/api/voice/retell", {
      method: "POST",
      body,
      headers: { "x-retell-signature": `v=${at},d=${digest}` },
    }),
  );
};

describe("Retell's webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RETELL_API_KEY", "key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a bad signature, or no key set", async () => {
    expect((await post("{}", "wrong")).status).toBe(401);
    vi.stubEnv("RETELL_API_KEY", "");
    expect((await post("{}", "")).status).toBe(401);
    expect(handleCallResult).not.toHaveBeenCalled();
  });

  it("passes on an analyzed call, and only that", async () => {
    const ended = JSON.stringify({ event: "call_ended", call: { metadata: { token: "t" } } });
    expect((await post(ended)).status).toBe(204);
    expect(handleCallResult).not.toHaveBeenCalled();
    const analyzed = JSON.stringify({
      event: "call_analyzed",
      call: { metadata: { token: "t" }, transcript: "x", disconnection_reason: "dial_busy" },
    });
    expect((await post(analyzed)).status).toBe(204);
    expect(handleCallResult).toHaveBeenCalledWith(
      "t",
      expect.objectContaining({ outcome: "no_answer" }),
    );
  });
});
