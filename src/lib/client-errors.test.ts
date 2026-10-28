import { describe, expect, it } from "vitest";
import { describeClientError } from "./client-errors";

describe("describeClientError", () => {
  it("keeps what failed and where, never what was typed", () => {
    expect(
      describeClientError({
        name: "RangeError",
        message: `Invalid amount '1,240.50' for "rent at Oak Ridge" from sam@example.com, $300`,
        stack: "RangeError: Invalid amount '1,240.50'\n    at parse (app/page.js:12:3)",
        path: "/import?q=secret",
      }),
    ).toEqual({
      message: "RangeError: Invalid amount [text] for [text] from [email], [n]",
      stack: "RangeError: Invalid amount [text]\n    at parse (app/page.js:12:3)",
      path: "/import",
    });
  });

  it("gives an odd name a plain one, and ignores what isn't an error", () => {
    expect(describeClientError({ name: "<script>", message: "boom" })?.message).toBe("Error: boom");
    expect(describeClientError({ message: "" })).toBeNull();
    expect(describeClientError("boom")).toBeNull();
    expect(describeClientError({ message: "boom", path: "https://x" })?.path).toBeNull();
  });
});
