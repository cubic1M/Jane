import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/voice/calls", () => ({ handleCallResult: vi.fn(async () => "acted") }));

import { RETELL } from "@/config/retell";
import { handleCallResult } from "@/lib/voice/calls";
import { POST } from "./route";

const KEY = "test-retell-key";
const post = (body: unknown, signed = true) => {
  const raw = JSON.stringify(body);
  const v = Date.now();
  const signature = `v=${v},d=${createHmac("sha256", KEY)
    .update(raw + v)
    .digest("hex")}`;
  return POST(
    new Request("https://app.example.com/api/voice/retell", {
      method: "POST",
      headers: signed ? { [RETELL.signatureHeader]: signature } : {},
      body: raw,
    }),
  );
};
const analyzed = {
  event: "call_analyzed",
  call: {
    call_id: "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    metadata: { token: "reply-token" },
    transcript: "Agent: hi",
    call_analysis: { custom_analysis_data: { outcome: "refused" } },
  },
};

describe("POST /api/voice/retell", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(handleCallResult).mockClear();
  });

  it("needs Retell's signature with the API key", async () => {
    expect((await post(analyzed)).status).toBe(401);
    vi.stubEnv(RETELL.apiKeyEnv, KEY);
    expect((await post(analyzed, false)).status).toBe(401);
    expect(handleCallResult).not.toHaveBeenCalled();
  });

  it("gives a finished call's result to the agent by its reply token", async () => {
    vi.stubEnv(RETELL.apiKeyEnv, KEY);
    expect((await post(analyzed)).status).toBe(200);
    expect(handleCallResult).toHaveBeenCalledWith("reply-token", {
      outcome: "refused",
      transcript: "Agent: hi",
      newMonthlyCents: null,
      offer: null,
      offerTerms: null,
    });
  });

  it("acknowledges other events, and refuses a result with no token", async () => {
    vi.stubEnv(RETELL.apiKeyEnv, KEY);
    expect((await post({ event: "call_started", call: {} })).status).toBe(204);
    expect((await post({ ...analyzed, call: { ...analyzed.call, metadata: {} } })).status).toBe(
      400,
    );
    expect(handleCallResult).not.toHaveBeenCalled();
  });
});
