import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("signing out from a page", () => {
  // /mfa's "Sign out instead" had its own form and left the tab's cards and the notifications on.
  it("always goes through the form that clears what the browser kept", () => {
    const users = execFileSync("git", ["grep", "-l", "signOutToHome", "--", "src"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((file) => !/\.test\.tsx?$/.test(file));
    expect(users.sort()).toEqual(["src/components/sign-out-form.tsx", "src/lib/auth-actions.ts"]);
  });
});
