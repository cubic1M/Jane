import { describe, expect, it } from "vitest";
import {
  CHAT_CLAUDE_DAILY_CAP_CENTS,
  CHAT_TRIAL_MESSAGES,
  CHAT_TYPICAL_ANSWER_CENTS,
} from "./agent-chat";

describe("chat Claude caps", () => {
  it("lets a sample person's whole allowance of typical answers fit under the daily cap", () => {
    expect(CHAT_TRIAL_MESSAGES * CHAT_TYPICAL_ANSWER_CENTS).toBeLessThan(
      CHAT_CLAUDE_DAILY_CAP_CENTS,
    );
  });
});
