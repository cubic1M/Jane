import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debug 2 re-walk (11-16, a Fidelity positions upload, 1280 light): Investments opened with "Your
// accounts, as your bank reports them." over holdings the student had uploaded themselves. The
// line names both ways accounts get in.

const page = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the Investments page's first line", () => {
  it("doesn't say an upload is the bank's report", () => {
    expect(page).not.toContain("as your bank reports them");
    expect(page).toContain("Your accounts, from your bank and your uploads.");
  });
});
