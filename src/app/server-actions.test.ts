import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Next.js refuses to build when a "use server" file exports anything but async functions,
// and unit tests don't run the production build, so check it here.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('"use server" files', () => {
  it("export only async functions and types", () => {
    const offenders = sourceFiles("src").flatMap((file) => {
      const text = readFileSync(file, "utf8");
      if (!/^\s*["']use server["'];?/.test(text)) return [];
      return text
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /^export (?!async function|type |interface )/.test(line))
        .map(({ line, i }) => `${file}:${i + 1}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });
});
