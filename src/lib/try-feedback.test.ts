import { describe, expect, it } from "vitest";
import { scrubFeedback } from "./try-feedback";

describe("scrubFeedback", () => {
  it("takes out emails and long numbers", () => {
    expect(scrubFeedback("I'm sam@example.com, card 4111 1111 1111 1111, acct 12345678")).toBe(
      "I'm [email], card [number], acct [number]",
    );
  });

  it("keeps amounts, dates and short numbers: they're the point", () => {
    const text = "It said $1,234.56 on 10/31/2026 and I have 3 cards ending 5003";
    expect(scrubFeedback(text)).toBe(text);
  });
});
