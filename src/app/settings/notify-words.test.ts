import { describe, expect, it } from "vitest";
import { QUIET_END_HOUR, QUIET_START_HOUR } from "@/config/agent-chat";
import { CHAT_NOTIFY_DAILY_LIMIT } from "@/config/chat-notify";
import { clock, messagesFromJaneWords } from "./notify-words";

describe("messagesFromJaneWords", () => {
  const words = messagesFromJaneWords();

  it("gives the phone cap and the one daily email, not one cap for both", () => {
    expect(words).toContain(`Phone notifications: at most ${CHAT_NOTIFY_DAILY_LIMIT} a day.`);
    expect(words).toContain("what can wait comes together in one email a day");
    expect(words).not.toMatch(/^.*At most \d+ a day, never/);
  });

  it("says urgent messages come right away", () => {
    expect(words).toContain(
      "something urgent, like a bill to pay or a paycheck that stopped, comes right away",
    );
  });

  it("keeps the quiet hours", () => {
    expect(words).toContain(
      `Never between ${clock(QUIET_START_HOUR)} and ${clock(QUIET_END_HOUR)}`,
    );
  });

  it("writes hours the way people say them", () => {
    expect([clock(0), clock(9), clock(12), clock(21)]).toEqual(["12am", "9am", "12pm", "9pm"]);
  });
});
