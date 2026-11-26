import { describe, expect, it } from "vitest";
import { parseAmount } from "./amount";

// CodeRabbit part 2: the first amount typed wins, however it is written.
describe("an amount typed in the chat", () => {
  it("takes the first one, not the first of one kind", () => {
    expect(parseAmount("$900 with 2k saved")).toBe(90_000);
    expect(parseAmount("900 dollars with $2000 saved")).toBe(90_000);
    expect(parseAmount("2k saved and $900 to spend")).toBe(200_000);
  });

  it("still reads one amount, and prefers money over a count", () => {
    expect(parseAmount("can I afford $1,200.50?")).toBe(120_050);
    expect(parseAmount("I have 5 cards and want to pay $200")).toBe(20_000);
    expect(parseAmount("1.2k")).toBe(120_000);
    expect(parseAmount("how are you")).toBeNull();
  });
});
