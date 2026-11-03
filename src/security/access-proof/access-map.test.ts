import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_MAP, accessKind } from "@/config/access-map";
import { allSurfaces, kindOfFile, urlOf } from "./surfaces";

// The route inventory. Every way into the app is declared public, signed-in, admin, cron or webhook
// in src/config/access-map.ts, so adding one means saying who it's for. What each entry claims is
// then attacked by access.proof.test.ts; this file runs with the unit tests and needs no database.

const surfaces = allSurfaces();
const files = new Set(surfaces.map((s) => s.file));

describe("the route inventory", () => {
  it("finds the app's routes, actions and pages", () => {
    const count = (kind: string) => surfaces.filter((s) => s.kind === kind).length;
    // Fewer than this means the walk broke, not that the app shrank.
    expect(count("route")).toBeGreaterThanOrEqual(50);
    expect(count("action")).toBeGreaterThanOrEqual(110);
    expect(count("page")).toBeGreaterThanOrEqual(150);
  });

  it("every one is declared in src/config/access-map.ts", () => {
    const undeclared = [...files].filter((file) => !(file in ACCESS_MAP));
    expect(
      undeclared,
      "New route, action or page: add it to src/config/access-map.ts with who it's for",
    ).toEqual([]);
  });

  it("nothing is declared that no longer exists", () => {
    expect(Object.keys(ACCESS_MAP).filter((file) => !files.has(file))).toEqual([]);
  });

  it("a public one says why", () => {
    const silent = Object.entries(ACCESS_MAP).filter(
      ([, access]) => typeof access !== "string" && access.why.trim().length < 10,
    );
    expect(silent).toEqual([]);
  });

  it("anything under /admin is admin, and anything under /api/cron is cron", () => {
    const wrong = Object.entries(ACCESS_MAP).flatMap(([file, access]) => {
      const kind = accessKind(access);
      if (file.startsWith("src/app/admin/") && kind !== "admin") return [`${file}: ${kind}`];
      if (file.startsWith("src/app/api/cron/") && kind !== "cron") return [`${file}: ${kind}`];
      return [];
    });
    expect(wrong).toEqual([]);
  });

  // The hourly probe has its own secret, so it stays off until a founder sets it.
  it("a cron route reads CRON_SECRET or PROBE_SECRET and a webhook checks a signature, in its own file", () => {
    const missing = Object.entries(ACCESS_MAP).flatMap(([file, access]) => {
      const kind = accessKind(access);
      const source = kind === "cron" || kind === "webhook" ? readFileSync(file, "utf8") : "";
      if (kind === "cron" && !/CRON_SECRET|PROBE_SECRET|authorizeCron|isCron/.test(source))
        return [file];
      if (kind === "webhook" && !/verif|signature|secret/i.test(source)) return [file];
      return [];
    });
    expect(missing).toEqual([]);
  });

  it("nothing turns the raw client rule off in a file", () => {
    expect(allSourceDisables().filter((line) => /no-raw-db/.test(line))).toEqual([]);
  });
});

function allSourceDisables(): string[] {
  return allFiles("src").flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("eslint-disable"))
      .map((line) => `${file}: ${line.trim()}`),
  );
}

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path.includes("generated") ? [] : allFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("how the inventory reads a file", () => {
  const source = (text: string) => () => text;

  it("routes, pages and Next.js's own files that answer a URL", () => {
    expect(kindOfFile("src/app/api/x/route.ts", source(""))).toBe("route");
    expect(kindOfFile("src/app/api/x/route.tsx", source(""))).toBe("route");
    expect(kindOfFile("src/app/x/page.tsx", source(""))).toBe("page");
    expect(kindOfFile("src/app/manifest.ts", source(""))).toBe("route");
    expect(kindOfFile("src/app/x/opengraph-image.tsx", source(""))).toBe("route");
  });

  it("server actions by name, or by the directive in a file with any other name", () => {
    expect(kindOfFile("src/app/x/actions.ts", source(""))).toBe("action");
    expect(kindOfFile("src/lib/compare-actions.ts", source(""))).toBe("action");
    expect(
      kindOfFile("src/app/chat/send.ts", source('"use server";\nexport async function a() {}')),
    ).toBe("action");
    expect(kindOfFile("src/app/x/y.ts", source('// note\n"use server";'))).toBe("action");
  });

  it("not tests, helpers or a mention of the directive in a comment", () => {
    expect(kindOfFile("src/app/x/actions.test.ts", source(""))).toBeNull();
    expect(kindOfFile("src/lib/helper.ts", source("export const a = 1;"))).toBeNull();
    expect(
      kindOfFile("src/app/x/fields.ts", source('// a "use server" file\nexport const a = 1;')),
    ).toBeNull();
    expect(kindOfFile("src/app/x/layout.tsx", source(""))).toBeNull();
  });

  it("works out a URL, without route groups", () => {
    expect(urlOf("src/app/(auth)/login/page.tsx")).toBe("/login");
    expect(urlOf("src/app/page.tsx")).toBe("/");
    expect(urlOf("src/app/api/x/[id]/route.ts")).toBe("/api/x/[id]");
  });
});
