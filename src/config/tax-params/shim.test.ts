import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("tax-rates.ts keeps no federal figure of its own", () => {
  it("has no dollar literal before the state schedules", () => {
    const text = readFileSync(join(__dirname, "..", "tax-rates.ts"), "utf8");
    const federal = text.slice(0, text.indexOf("// State income tax."));
    expect(federal).not.toMatch(/\$\(/);
  });
});
