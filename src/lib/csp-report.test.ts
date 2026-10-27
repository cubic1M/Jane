import { describe, expect, it } from "vitest";
import { parseCspReports } from "./csp-report";

describe("parseCspReports", () => {
  it("reads report-uri's format: the rule, where from, and the page without its query", () => {
    const raw = JSON.stringify({
      "csp-report": {
        "document-uri": "https://jane.example/connect?email=a@b.co&token=secret",
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?session=abc",
        "script-sample": "alert(document.cookie)",
      },
    });
    expect(parseCspReports(raw)).toEqual([
      { directive: "script-src-elem", blocked: "https://evil.example", page: "/connect" },
    ]);
  });

  it("reads the Reporting API's format, and inline or eval blocks", () => {
    const raw = JSON.stringify([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://jane.example/home",
          effectiveDirective: "script-src-elem",
          blockedURL: "inline",
        },
      },
      { type: "deprecation", body: {} },
    ]);
    expect(parseCspReports(raw)).toEqual([
      { directive: "script-src-elem", blocked: "inline", page: "/home" },
    ]);
  });

  it("ignores what browser extensions inject", () => {
    const raw = JSON.stringify({
      "csp-report": {
        "document-uri": "https://jane.example/home",
        "effective-directive": "script-src-elem",
        "blocked-uri": "chrome-extension://abcdef/inject.js",
      },
    });
    expect(parseCspReports(raw)).toEqual([]);
  });

  it("drops what isn't a report: bad JSON, huge bodies, other shapes", () => {
    expect(parseCspReports("not json")).toEqual([]);
    expect(parseCspReports(JSON.stringify({ hello: 1 }))).toEqual([]);
    expect(parseCspReports("x".repeat(30_000))).toEqual([]);
  });
});
