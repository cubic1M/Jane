import { describe, expect, it } from "vitest";
import { REPORT_MAX_CHARS, cleanReport, reportPath } from "./problem-reports";

describe("reportPath", () => {
  it("keeps our own page's path, never its query or another site", () => {
    expect(reportPath("/net-worth")).toBe("/net-worth");
    // A search's words are the person's: dropped.
    expect(reportPath("/transactions?q=planned+parenthood")).toBe("/transactions");
    expect(reportPath("/import#history")).toBe("/import");
    expect(reportPath("//evil.example/x")).toBe("/");
    expect(reportPath("https://evil.example")).toBe("/");
    expect(reportPath(undefined)).toBe("/");
  });
});

describe("cleanReport", () => {
  it("keeps the person's words and the page", () => {
    expect(cleanReport("/home", "  The chart is blank.  ")).toEqual({
      path: "/home",
      message: "The chart is blank.",
    });
  });

  it("asks for words, and keeps them short enough", () => {
    expect(cleanReport("/home", "   ")).toBe("Say what went wrong, in a few words.");
    expect(cleanReport("/home", "x".repeat(REPORT_MAX_CHARS + 1))).toBe(
      "Keep it under 2,000 characters.",
    );
  });
});
