import { describe, expect, it } from "vitest";
import { REPORT_MAX_CHARS, cleanReport, reportPath } from "./problem-reports";

describe("reportPath", () => {
  it("keeps our own page's path, never its query or another site", () => {
    expect(reportPath("/net-worth")).toBe("/net-worth");
    // A search's words are the person's: dropped.
    expect(reportPath("/transactions?q=planned+parenthood")).toBe("/transactions");
    expect(reportPath("/import#history")).toBe("/import");
    expect(reportPath("//evil.example/x")).toBe("/");
    expect(reportPath("/\\evil.example/x")).toBe("/");
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

describe("the page a report goes back to", () => {
  it.each([
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r\n/evil.example",
    "/\\evil.example",
    "//evil.example",
    "/a\\b",
  ])("is this site's home for %j, which a browser would read as another site", (from) => {
    expect(reportPath(from)).toBe("/");
  });

  it("keeps an ordinary page", () => {
    expect(reportPath("/report/abc.x?q=1")).toBe("/report/abc.x");
  });
});
