import { describe, expect, it } from "vitest";
import { laneOf, readTranscript } from "../../scripts/ops/attribution.mjs";

const assistant = (timestamp: string, tokens: number, words = "x") =>
  JSON.stringify({
    type: "assistant",
    timestamp,
    version: "2.1.309",
    message: {
      model: "claude-opus-5-5",
      content: words,
      usage: {
        input_tokens: tokens,
        output_tokens: tokens,
        cache_creation_input_tokens: tokens,
        cache_read_input_tokens: 999_999,
      },
    },
  });

describe("the Agent line", () => {
  it("adds tokens from the branch's first commit on, leaving out cache reads", () => {
    const text = [
      assistant("2026-11-03T01:00:00.000Z", 100),
      "not json with assistant in it",
      assistant("2026-11-03T03:00:00.000Z", 10),
      JSON.stringify({ type: "user", timestamp: "2026-11-03T04:00:00.000Z" }),
    ].join("\n");
    expect(readTranscript(text, "2026-11-03T02:00:00.000Z")).toEqual({
      model: "claude-opus-5-5",
      version: "2.1.309",
      tokens: 30,
    });
  });
  it("says unknown with no transcript content", () => {
    expect(readTranscript("", "2026-11-03T02:00:00.000Z")).toEqual({
      model: "unknown",
      version: "unknown",
      tokens: 0,
    });
  });
  it("takes the lane from the branch", () => {
    expect(laneOf("claude/scanners-alarms-ee8662")).toBe("scanners");
    expect(laneOf("nd/rls-fix")).toBe("rls");
    expect(laneOf("ops/numbers")).toBe("ops");
  });
});
