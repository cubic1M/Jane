import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-16 (a U.S. Bank checking upload on a phone): right after the upload, its result asked
// "What's in US Bank checking today?", and "Your accounts" below said "One account has no balance
// yet. Add it below and net worth counts it." over no field: the list's copy of the question waits
// while the upload's is showing (#1888). The line counts only the questions still waiting in the
// list. Tests here render on the server, where effects don't run, so this reads the component;
// e2e/balance-line-points-at-a-question.spec.ts walks it.

const history = readFileSync(join(__dirname, "upload-history.tsx"), "utf8");

describe("the line over Your accounts", () => {
  it("counts only the balance questions still waiting in the list", () => {
    expect(history).toMatch(
      /const waiting = asks\.filter\(\(ask\) => !above\.has\(ask\.accountId\)\)/,
    );
    expect(history).toMatch(/\{waiting\.length > 0 && \(/);
    expect(history).not.toMatch(/\{asks\.length > 0 && \(/);
  });
});
