import { describe, expect, it } from "vitest";
import {
  REPORT_MAX_CHARS,
  FEEDBACK_MAX_UPLOAD_BYTES,
  cleanReport,
  cleanScreenshot,
  imageType,
  reportPath,
} from "./problem-reports";

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

describe("a feedback screenshot", () => {
  const file = (bytes: number[], size?: number) =>
    new File(
      [new Uint8Array(size ? new Array(size).fill(0).map((_, i) => bytes[i] ?? 0) : bytes)],
      "x",
    );

  it("is known by its first bytes: PNG, JPEG or WebP, nothing else", () => {
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      imageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image/webp");
    expect(imageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });

  it("is optional, and refused when too big", async () => {
    expect(await cleanScreenshot(null)).toBeNull();
    expect(await cleanScreenshot(new File([], "empty.png"))).toBeNull();
    expect(await cleanScreenshot(file([0xff, 0xd8, 0xff], FEEDBACK_MAX_UPLOAD_BYTES + 1))).toMatch(
      /too big/,
    );
    expect(await cleanScreenshot(file([0xff, 0xd8, 0xff, 1]))).toMatchObject({
      type: "image/jpeg",
    });
  });
});
