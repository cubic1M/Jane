import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AnthropicCallInTest, LIVE_FLAGS } from "./no-anthropic";

// Spec step 293: the suite makes zero Anthropic calls. ./no-anthropic.ts runs before every test
// file and fails any request to the Anthropic API, so a passing suite is one that made none.
// These tests prove the guard is on for every file and that the SDK's own requests hit it.

const live = LIVE_FLAGS.some((flag) => process.env[flag] === "1");
const calls = () => (globalThis as { __anthropicCallsInTests?: number }).__anthropicCallsInTests;

describe.skipIf(live)("zero Anthropic calls in the test suite", () => {
  it("runs the guard before every test file", () => {
    const config = readFileSync("vitest.config.mts", "utf8");
    expect(config).toMatch(/setupFiles:\s*\[[^\]]*"src\/test-setup\/no-anthropic\.ts"/);
    expect(calls()).toBe(0);
  });

  it("fails a direct request to the API and counts it", async () => {
    await expect(
      fetch("https://api.anthropic.com/v1/messages", { method: "POST" }),
    ).rejects.toThrow(AnthropicCallInTest);
    expect(calls()).toBe(1);
  });

  it("fails a request made through the SDK, even with a key", async () => {
    const before = calls() ?? 0;
    const client = new Anthropic({ apiKey: "test-key-not-real", maxRetries: 0 });
    await expect(
      client.messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow();
    expect(calls()).toBe(before + 1);
  });
});
