import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("signing out from a page", () => {
  // /mfa's "Sign out instead" had its own form and left the tab's cards and the notifications on.
  it("always clears what the browser kept", () => {
    const users = execFileSync("git", ["grep", "-l", "action={signOutToHome}", "--", "src"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((file) => !/\.test\.tsx?$/.test(file));
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) {
      expect(readFileSync(file, "utf8")).toContain("onSubmit={forgetOnThisBrowser}");
    }
  });
});
