import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-16 (a Chase card on desktop, 14 months of Wells Fargo on a phone): right after the
// upload, "What's in Wells Fargo checking today?" was asked in the upload's result and again in
// "Your accounts" below it, two fields for one answer. The list's question waits while the
// upload's own is showing, and comes back if that one is skipped. Tests here render on the server,
// where effects don't run, so this reads the component; e2e/balance-asked-once.spec.ts walks it.

const form = readFileSync(join(__dirname, "balance-ask.tsx"), "utf8");

describe("the balance question after an upload", () => {
  it("is asked once: the list's copy waits while the upload's own is showing", () => {
    expect(form).toMatch(/const askedAbove = new Map<string, number>\(\)/);
    expect(form).toMatch(/const inList = !skippable;/);
    expect(form).toMatch(/if \(state === "skipped" \|\| shownAbove\) return null;/);
  });
});
