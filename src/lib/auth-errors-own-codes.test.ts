import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

// ?error= is anyone's to write: a name every object has gave the page an object to show as text.
const FALLBACK = "Something went wrong signing you in. Please try again.";

describe("an error code from the address", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", ""])(
    "that isn't one of ours reads as the usual message, or none (%s)",
    (code) => {
      expect(authErrorMessage(code)).toBe(code ? FALLBACK : null);
    },
  );

  it("that is ours still reads as its message", () => {
    expect(authErrorMessage(["InvalidInvite"])).toContain("isn't valid");
  });
});
