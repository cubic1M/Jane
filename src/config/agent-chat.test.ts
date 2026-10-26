import { describe, expect, it } from "vitest";
import {
  CHAT_MONTHLY_CAP_CENTS_DEFAULT,
  CHAT_PERSON_DAILY_CAP_CENTS,
  CHAT_TRIAL_DAILY_CAP_CENTS,
  CHAT_TRIAL_MESSAGES,
  CHAT_TYPICAL_ANSWER_CENTS,
} from "./agent-chat";

describe("chat Claude caps", () => {
  it("lets a sample person's whole allowance of typical answers fit under their daily cap", () => {
    expect(CHAT_TRIAL_MESSAGES * CHAT_TYPICAL_ANSWER_CENTS).toBeLessThan(
      CHAT_TRIAL_DAILY_CAP_CENTS,
    );
  });

  // Founder (2026-10-26): one person can't use up the month.
  it("keeps one person at their daily limit every day of a month under the monthly cap", () => {
    expect(31 * CHAT_PERSON_DAILY_CAP_CENTS).toBeLessThan(CHAT_MONTHLY_CAP_CENTS_DEFAULT);
  });

  it("still gives a person several typical answers a day", () => {
    expect(CHAT_PERSON_DAILY_CAP_CENTS / CHAT_TYPICAL_ANSWER_CENTS).toBeGreaterThanOrEqual(5);
  });
});
