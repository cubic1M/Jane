import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Main 11-14: e2e/hubs.spec.ts linked the demo bank and went /connect, /scanning?then=home,
// /connect on all three tries. The rounds of preloads are held back on this page
// (./scanning-progress.test.tsx), but one that started on /connect can still be on its way when the
// bank is linked: its Home is the redirect to /connect for someone with no bank, and it lands in
// the router's memory after the link's post emptied it. The hand-off is the one place that answer
// is read, so it loads Home afresh.

const source = readFileSync(join(__dirname, "scanning-progress.tsx"), "utf8");

describe("the first scan's hand-off", () => {
  it("loads the next page afresh, never from the router's memory", () => {
    expect(source).toMatch(/window\.location\.replace\(next\)/);
    expect(source).not.toMatch(/router\.(replace|push)\(/);
  });
});
