import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Code every page would carry is kept out of the root layout's own chunks (speed round, 11-15):
// the card dock's cards (only a computer draws the dock) and the activity recorder (it starts once
// the page is up). Each is reached only by import(). This walks the layout's static imports, so a
// plain `import` that pulls one back in fails here, not in a bundle no one looks at.
const ROOT = resolve(__dirname, "../..");
const LAYOUT = join(ROOT, "src/app/layout.tsx");
const KEPT_OUT = [
  "src/app/chat/suggestion-cards.tsx",
  "src/components/floating-cards.tsx",
  "src/lib/activity/recorder.ts",
];

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext) && !(base + ext).endsWith("/") && /\.(ts|tsx)$/.test(base + ext)) {
      return base + ext;
    }
  }
  return null;
}

// `import x from "y"` and `export … from "y"`, not `import type`, and not import("y").
const STATIC_IMPORT = /^(?:import|export)\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^import\s+["']([^"']+)["']/gm;

function reachable(start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const pattern of [STATIC_IMPORT, SIDE_EFFECT_IMPORT]) {
      for (const [, spec] of code.matchAll(pattern)) {
        const next = resolveImport(file, spec);
        if (next && !seen.has(next)) queue.push(next);
      }
    }
  }
  return seen;
}

describe("what every page loads", () => {
  const files = new Set([...reachable(LAYOUT)].map((f) => f.slice(ROOT.length + 1)));

  it("walks the layout's own components", () => {
    expect(files).toContain("src/components/side-chat/card-dock.tsx");
    expect(files).toContain("src/components/activity-recorder.tsx");
  });

  it.each(KEPT_OUT)("never statically reaches %s", (file) => {
    expect(files).not.toContain(file);
  });
});
