import { describe, expect, it } from "vitest";
import { normalizePath, redactText } from "./redact";

// The database refuses a null character: one in a batch failed the whole write.
describe("a null character in what the browser sends", () => {
  it("is left out of labels and paths", () => {
    expect(redactText("Sa\u0000ve")).toBe("Save");
    expect(normalizePath("/ho\u0000me")).toBe("/home");
  });
});
