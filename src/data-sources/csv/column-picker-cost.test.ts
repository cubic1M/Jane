import { describe, expect, it, vi } from "vitest";

vi.mock("@/categorize/rules", async (actual) => {
  const real = await actual<typeof import("@/categorize/rules")>();
  return { ...real, categorizeByRules: vi.fn(real.categorizeByRules) };
});

import { categorizeByRules } from "@/categorize/rules";
import { guessSign, mappingChoices } from "./column-mapping";

// An independent read of the upload: a 1 MB file with 79 number columns and 3,000 rows asked the
// rules about every description once per column. 34.7 seconds of CPU on one request, with others
// waiting 21.8 seconds, from a session anyone can start.
describe("the column picker's cost", () => {
  const COLUMNS = 40;
  const ROWS = 50;
  const header = ["description", ...Array.from({ length: COLUMNS }, (_, i) => `a${i}`)];
  const records = [
    header,
    ...Array.from({ length: ROWS }, (_, r) => [`NOTHING KNOWN ${r}`, ...Array(COLUMNS).fill("1")]),
  ].map((fields, i) => ({ line: i + 1, fields }));

  it("asks the rules about each description once, however many columns hold numbers", () => {
    vi.mocked(categorizeByRules).mockClear();
    const choices = mappingChoices(records);
    expect(Object.keys(choices.signs)).toHaveLength(COLUMNS);
    // Two questions a description: as money in, then as money out.
    expect(vi.mocked(categorizeByRules).mock.calls.length).toBeLessThanOrEqual(2 * ROWS);
  });

  it("reads every column's sign as it did", () => {
    const rows = [
      ["SALARY PAYROLL", "1000.00", "-1000.00"],
      ["WHOLE FOODS MARKET", "-50.00", "50.00"],
      ["SAFEWAY", "-60.00", "60.00"],
    ];
    const directions = new Map();
    expect(guessSign(rows, 1, 0, directions).moneyOut).toBe("negative");
    expect(guessSign(rows, 2, 0, directions).moneyOut).toBe("positive");
    expect(guessSign(rows, 1, 0).moneyOut).toBe("negative");
    expect(guessSign(rows, 2, 0).moneyOut).toBe("positive");
  });
});
