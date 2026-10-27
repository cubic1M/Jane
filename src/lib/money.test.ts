import { describe, expect, it } from "vitest";
import { formatCents, formatWholeDollars, parseMoneyToCents, centsToInput } from "./money";

describe("parseMoneyToCents", () => {
  it.each([
    ["12.34", 1234],
    ["-12.34", -1234],
    ["1,234.56", 123456],
    ["$12", 1200],
    ["(12.34)", -1234],
    ["-$5.10", -510],
    ["$-5.10", -510],
    [".5", 50],
    ["0.1", 10],
    ["  7.00 ", 700],
    ["0.00", 0],
    ["-0.00", 0],
  ])("parses %s as %i cents", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "12.345", "1,23.00", "--5", "12.3.4", "$"])("rejects %j", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });

  it("does not lose precision on values floats get wrong", () => {
    expect(parseMoneyToCents("0.29")).toBe(29);
    expect(parseMoneyToCents("1.15")).toBe(115);
  });
});

describe("formatCents", () => {
  it("formats dollars", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-500)).toBe("-$5.00");
  });
});

describe("formatWholeDollars", () => {
  it("rounds to whole dollars with thousands separators", () => {
    expect(formatWholeDollars(123_456)).toBe("$1,235");
    expect(formatWholeDollars(123_449)).toBe("$1,234");
    expect(formatWholeDollars(0)).toBe("$0");
    expect(formatWholeDollars(100_000_000)).toBe("$1,000,000");
  });
});

describe("centsToInput", () => {
  it("writes cents the way a money field holds them, and back", () => {
    expect(centsToInput(123456)).toBe("1234.56");
    expect(centsToInput(-500)).toBe("-5.00");
    expect(parseMoneyToCents(centsToInput(1999))).toBe(1999);
  });

  it("leaves a field empty when nothing is known", () => {
    expect(centsToInput(null)).toBe("");
    expect(centsToInput(undefined)).toBe("");
  });
});
