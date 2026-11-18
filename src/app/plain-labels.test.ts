import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Blinded, ShowValue } from "@/components/hub/blinded";

// The readable style (founder, 2026-11-18: "it looks like a terminal"): labels are plain words.
// "[SHOW VALUE]" is "Show", "[EXPAND]" is "Expand", "[WHY THIS NUMBER]" is "Why this number?",
// "ASK JANE" is "Ask Jane". The places swept so far; each sweep adds its own.
const SWEPT = ["src/components/hub", "src/app/home"];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });

// A label written into the markup: text between tags, or a string a label is chosen from.
const LABEL_IN_BRACKETS = /(>\s*|"|`)\[[A-Z✓‹›][^\]"`<>{}]{0,40}\](\s*<|"|`)/;
// Or text on a line of its own: "[CLOSE] Last month's close ›".
const LINE_IN_BRACKETS = /^\s*\[[A-Z✓‹›][^\][_(){}=,]{0,40}\]/;
const LABEL_IN_CAPITALS = /(>\s*|\?\s*"|:\s*")[A-Z][A-Z …✓·?!-]{3,}(\s*<|")/;
const PROMPT_MARK = /(>|")\s*(&gt;_|>_|J_|&gt;|# )\s*(<|")/;

describe("plain words for labels", () => {
  for (const file of SWEPT.flatMap(files)) {
    it(`${file} has no bracket labels, capitals or prompt marks`, () => {
      const code = readFileSync(file, "utf8").replace(/\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");
      for (const line of code.split("\n")) {
        expect(line, file).not.toMatch(LABEL_IN_BRACKETS);
        expect(line, file).not.toMatch(LINE_IN_BRACKETS);
        expect(line, file).not.toMatch(LABEL_IN_CAPITALS);
        expect(line, file).not.toMatch(PROMPT_MARK);
      }
    });
  }

  it("shows a hidden figure as dots, with a Show button named for screen readers", () => {
    const hidden = renderToStaticMarkup(createElement(Blinded));
    expect(hidden).toContain('<span aria-hidden="true">•••••</span>');
    expect(hidden).toContain("Hidden");
    const text = (shown: boolean) =>
      renderToStaticMarkup(
        createElement(ShowValue, { shown, what: "net worth", onToggle: () => {} }),
      ).replace(/<[^>]+>/g, "");
    expect(text(false)).toBe("Show value of net worth");
    expect(text(true)).toBe("Hide value of net worth");
  });
});
