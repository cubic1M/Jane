import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/voice/calls", () => ({ handleCallResult: vi.fn(async () => "acted") }));

import { handleCallResult } from "@/lib/voice/calls";
import { POST } from "./route";

const post = (body: unknown, auth?: string) =>
  POST(
    new Request("https://app.example.com/api/voice/result", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(body),
    }),
  );
const good = { token: "t", outcome: "lowered", transcript: "...", newMonthlyCents: 9_900 };

describe("POST /api/voice/result", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("needs the shared secret", async () => {
    expect((await post(good)).status).toBe(401);
    vi.stubEnv("VOICE_WEBHOOK_SECRET", "s");
    expect((await post(good, "Bearer x")).status).toBe(401);
  });

  it("passes a well-formed result to the agent, and refuses others", async () => {
    vi.stubEnv("VOICE_WEBHOOK_SECRET", "s");
    expect((await post(good, "Bearer s")).status).toBe(200);
    expect(handleCallResult).toHaveBeenCalledWith("t", {
      outcome: "lowered",
      transcript: "...",
      newMonthlyCents: 9_900,
      offer: null,
    });
    for (const bad of [
      { ...good, outcome: "maybe" },
      { ...good, newMonthlyCents: -1 },
      { ...good, transcript: 5 },
    ]) {
      expect((await post(bad, "Bearer s")).status).toBe(400);
    }
  });
});
