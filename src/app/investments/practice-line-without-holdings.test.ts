import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-16 (a student with a Fidelity positions upload, phone): under their own holdings,
// Investments still said "Jane can also run a practice portfolio on made-up money. See it on sample
// data (opens a separate sample person in a new tab; use a private window to stay signed in to your
// own account)." The line is for a page with nothing else on it (e2e/investing-no-dead-end.spec.ts):
// someone whose holdings are shown doesn't need it. The page is a server component that reads the
// database, so this reads its source.

const page = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the practice portfolio line", () => {
  it("shows only when the person has no holdings on the page", () => {
    const at = page.indexOf("Jane can also run a practice portfolio on made-up money.");
    expect(at).toBeGreaterThan(0);
    const guard = page.slice(page.lastIndexOf("{", page.lastIndexOf("<p", at)), at);
    expect(guard).toMatch(/!facts/);
  });
});
