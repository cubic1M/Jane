import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every way into the app, found on disk: route handlers, server actions and pages. access-map.test
// fails when one isn't declared; the attack walks this same list.

export type SurfaceKind = "route" | "action" | "page";

const SKIP = /\.test\.tsx?$|\/__fixtures__\/|\/generated\//;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// A file whose first statement is "use server": every export is an action, whatever its name.
const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["'];?/;

export function kindOfFile(path: string, source: () => string): SurfaceKind | null {
  if (SKIP.test(path) || !/\.tsx?$/.test(path)) return null;
  if (path.startsWith("src/app/")) {
    if (/\/route\.tsx?$/.test(path)) return "route";
    if (/\/page\.tsx?$/.test(path)) return "page";
    // Next.js's file conventions that answer a URL of their own.
    if (/\/(manifest|sitemap|robots)\.ts$/.test(path)) return "route";
    if (/\/(opengraph-image|twitter-image|icon|apple-icon)\.tsx?$/.test(path)) return "route";
  }
  if (/actions\.tsx?$/.test(path)) return "action";
  return USE_SERVER.test(source()) ? "action" : null;
}

export type Surface = { file: string; kind: SurfaceKind };

export function allSurfaces(root = "src"): Surface[] {
  return walk(root)
    .map((path) => path.replaceAll("\\", "/"))
    .flatMap((file) => {
      const kind = kindOfFile(file, () => readFileSync(file, "utf8"));
      return kind ? [{ file, kind }] : [];
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

// The URL a file under src/app answers: route groups dropped, segments left as written.
export function urlOf(file: string): string {
  const path = file
    .replace(/^src\/app/, "")
    .replace(/\/(route|page)\.tsx?$/, "")
    .split("/")
    .filter((part) => !/^\(.*\)$/.test(part))
    .join("/");
  return path === "" ? "/" : path;
}

// A segment's parameter names: [id] and [...slug].
export function segmentNames(file: string): { name: string; catchAll: boolean }[] {
  return [...file.matchAll(/\[(\.\.\.)?(\w+)\]/g)].map((m) => ({
    name: m[2],
    catchAll: Boolean(m[1]),
  }));
}
