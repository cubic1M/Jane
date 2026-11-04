import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every internal path written in the source opens a real page or route (debugger 11-04: every
// urgent alert email linked to /alerts, deleted three weeks before, and nothing noticed). A hidden
// page counts: it redirects. A path built with a value counts as that value's segment.

const SRC = path.join(process.cwd(), "src");
const APP = path.join(SRC, "app");

function routes(dir = APP, parts: string[] = []): string[][] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      const inUrl = !e.name.startsWith("(");
      return routes(path.join(dir, e.name), inUrl ? [...parts, e.name] : parts);
    }
    return /^(page|route)\.tsx?$/.test(e.name) ? [parts] : [];
  });
}

function sources(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return ["generated", "__fixtures__"].includes(e.name) ? [] : sources(file);
    return /\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [file] : [];
  });
}

const WRITTEN = [
  /href=["'`{]+\/([a-z][a-z0-9\-/]*)(\$?)/g,
  /href:\s*["'`]\/([a-z][a-z0-9\-/]*)(\$?)/g,
  /\burl:\s*["'`]\/([a-z][a-z0-9\-/]*)(\$?)/g,
  /appBase\(\)\}\/([a-z][a-z0-9\-/]*)(\$?)/g,
  /links?\.base\}\/([a-z][a-z0-9\-/]*)(\$?)/g,
  /clickLink\([a-zA-Z]+,\s*["'`]\/([a-z][a-z0-9\-/]*)(\$?)/g,
];

describe("internal links", () => {
  const known = routes();
  const opens = (segments: string[]) =>
    known.some((route) => {
      const rest = route.at(-1)?.startsWith("[...") ? route.slice(0, -1) : route;
      if (rest === route && route.length !== segments.length) return false;
      if (rest !== route && segments.length < rest.length) return false;
      return rest.every((part, i) => part.startsWith("[") || part === segments[i]);
    });

  it("knows a real page from a missing one", () => {
    expect(opens(["jane"])).toBe(true);
    expect(opens(["report", "abc"])).toBe(true);
    expect(opens(["no-such-page"])).toBe(false);
  });

  it("every path written in the source opens a page or route", () => {
    const dead = sources().flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return WRITTEN.flatMap((pattern) =>
        [...text.matchAll(pattern)].flatMap((m) => {
          const segments = m[1].split("/").filter(Boolean);
          // ".../${id}": the value is one more segment. "/${x}" right after a word joins it.
          if (m[2] && m[1].endsWith("/")) segments.push("value");
          else if (m[2]) return [];
          return opens(segments) ? [] : [`/${m[1]} in ${path.relative(SRC, file)}`];
        }),
      );
    });
    expect([...new Set(dead)]).toEqual([]);
  });
});
