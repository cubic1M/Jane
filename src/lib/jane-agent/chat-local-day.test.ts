import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The chat's day is the person's (founder 10-23, src/lib/today.ts), and chatToday gives it. A new
// UTC date here brings back "$0.00 in November so far" on the evening of Oct 31. Checks work on
// throwaway people and pick their own moment.
const ROOT = join(process.cwd(), "src/lib/jane-agent");
const chatPathFiles = () =>
  readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("checks/"),
  );

describe("the chat path takes its day from the person", () => {
  it("reads files to check", () => {
    expect(chatPathFiles().length).toBeGreaterThan(100);
  });

  it("has no UTC date left", () => {
    const utc = /\bnow\.toISOString\(\)\.slice\(0, (?:7|10)\)/;
    expect(chatPathFiles().filter((f) => utc.test(readFileSync(join(ROOT, f), "utf8")))).toEqual(
      [],
    );
  });
});
