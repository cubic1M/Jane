import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Jane is black, white and greys only (docs/design/area-pages.md, "Visual language").
// - globals.css remaps every Tailwind colour palette to greys, so a class like text-emerald-700
//   is grey wherever it is.
// - No colour is written outside it: a hex colour in src must be a grey (#737373), so emails,
//   icons and charts that can't use the classes stay monochrome too.
// - Colour-named classes may not spread: each file may keep the ones it had when the site went
//   monochrome (monochrome-baseline.json), and new code uses neutral-* or zinc-*. When a file
//   drops some, run UPDATE_COLOR_BASELINE=1 npx vitest run src/app/monochrome.test.ts.

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const CSS = join(SRC, "app", "globals.css");
const BASELINE = join(SRC, "app", "monochrome-baseline.json");

const CHROMATIC = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];
// Greys with a tint, remapped to pure greys as well.
const TINTED = ["slate", "gray", "zinc", "stone", "mauve", "olive", "mist", "taupe"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Code without its comments: a PR number like "(#643)" isn't a colour.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const isGrey = (hex: string) => {
  const h = hex.slice(1).toLowerCase();
  const [r, g, b] = h.length === 3 ? [...h] : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return r === g && g === b;
};

const CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(?:bg|text|border|fill|stroke|ring|outline|from|to|via|decoration|accent|caret|divide|shadow|placeholder)-(?:${CHROMATIC.join("|")})-\\d{2,3}\\b`,
  "g",
);

function colourClasses(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of files(SRC)) {
    if (path === CSS) continue;
    const n = (code(readFileSync(path, "utf8")).match(CLASS) ?? []).length;
    if (n > 0) counts[relative(ROOT, path)] = n;
  }
  return counts;
}

describe("monochrome", () => {
  it("remaps every colour palette, and every shade of it, to a grey", () => {
    const theme = readFileSync(join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8");
    const css = readFileSync(CSS, "utf8");
    const block = css.match(/@theme \{([\s\S]*?)\}/)?.[1] ?? "";
    const missing: string[] = [];
    for (const palette of [...CHROMATIC, ...TINTED]) {
      for (const m of theme.matchAll(new RegExp(`--color-${palette}-(\\d+):`, "g"))) {
        const name = `--color-${palette}-${m[1]}`;
        if (!new RegExp(`${name}: oklch\\([\\d.]+% 0 0\\);`).test(block)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("writes no colour outside the token file: every hex colour is a grey", () => {
    const found: string[] = [];
    for (const path of files(SRC)) {
      if (path === CSS) continue;
      const text = code(readFileSync(path, "utf8"));
      for (const m of text.matchAll(/(?<=["'`[(:\s,])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
        // "#112" is a store number; a three-digit colour has a letter in it.
        if (m[0].length === 4 && !/[a-f]/i.test(m[0])) continue;
        if (!isGrey(m[0])) found.push(`${relative(ROOT, path)}: ${m[0]}`);
      }
      for (const m of text.matchAll(/\b(?:rgba?|hsla?)\(([^)]*)\)/g)) {
        const [r, g, b] = m[1].split(/[\s,/]+/);
        if (m[0].startsWith("hsl") || r !== g || g !== b) {
          found.push(`${relative(ROOT, path)}: ${m[0]}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("keeps colour-named classes from spreading to new code", () => {
    const now = colourClasses();
    if (process.env.UPDATE_COLOR_BASELINE) {
      writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
    }
    const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE, "utf8"));
    const grown = Object.entries(now)
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} colour classes (was ${baseline[file] ?? 0})`);
    expect(grown).toEqual([]);
  });
});
