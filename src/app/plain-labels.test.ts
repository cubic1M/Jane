import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Blinded, ShowValue } from "@/components/hub/blinded";

// The readable style (founder, 2026-11-18: "it looks like a terminal"): labels are plain words.
// "[SHOW VALUE]" is "Show", "[EXPAND]" is "Expand", "[WHY THIS NUMBER]" is "Why this number?",
// "ASK JANE" is "Ask Jane". Every page and component but the landing page, which keeps its own
// look (src/app/page.tsx and what only it uses).
const LANDING = [
  "src/app/page.tsx",
  "src/app/landing-mode-switch.tsx",
  "src/components/get-started-button.tsx",
];
const SWEPT = ["src/app", "src/components"];

const files = (dir: string): string[] =>
  statSync(dir).isFile()
    ? [dir]
    : readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
      });

// A label written into the markup: text between tags, or a string a label is chosen from.
const LABEL_IN_BRACKETS = /(>\s*|"|`)\[[A-Z✓‹›][^\]"`<>{}]{0,40}\](\s*<|"|`)/;
// Or text on a line of its own: "[CLOSE] Last month's close ›".
const LINE_IN_BRACKETS = /^\s*\[[A-Z✓‹›][^\][_(){}=,]{0,40}\]/;
const LABEL_IN_CAPITALS =
  /(>\s*|\?\s*"|:\s*")(?!(GET|POST|PUT|PATCH|DELETE|HEAD)")(● [A-Z]{3,}|[A-Z][A-Z …✓·?!-]{3,})(\s*<|")/;
// Brackets drawn round a label as decoration: <span aria-hidden="true">[</span>.
const DRAWN_BRACKET = /aria-hidden(="true")?>\s*(\[|&nbsp;\]|\])/;
const PROMPT_MARK = /(>|")\s*(&gt;_|>_|J_|&gt;|# )\s*(<|")/;
// Or brackets drawn round a value: "▲ [{CHANGE_LABEL[c.kind]}]".
const VALUE_IN_BRACKETS = /(>|^\s+)[^<>"`=]*\[\{[A-Za-z_.]+(\[[A-Za-z_.]+\])?\}\]/;
// Or a mark on a line of its own: "J_", ">_".
const LINE_MARK = /^\s*(&gt;_|>_|J_|&gt;)\s*$/;

describe("plain words for labels", () => {
  for (const file of SWEPT.flatMap(files).filter((f) => !LANDING.includes(f))) {
    it(`${file} has no bracket labels, capitals or prompt marks`, () => {
      const code = readFileSync(file, "utf8").replace(/\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");
      for (const line of code.split("\n")) {
        expect(line, file).not.toMatch(LABEL_IN_BRACKETS);
        expect(line, file).not.toMatch(LINE_IN_BRACKETS);
        expect(line, file).not.toMatch(LABEL_IN_CAPITALS);
        expect(line, file).not.toMatch(PROMPT_MARK);
        expect(line, file).not.toMatch(LINE_MARK);
        expect(line, file).not.toMatch(VALUE_IN_BRACKETS);
        expect(line, file).not.toMatch(DRAWN_BRACKET);
      }
    });
  }

  it("writes no label in capitals by CSS, but the invite code people type", () => {
    const upper = SWEPT.flatMap(files)
      .filter((f) => !LANDING.includes(f))
      .filter((f) => /\buppercase\b/.test(readFileSync(f, "utf8")));
    expect(upper).toEqual(["src/components/auth-form.tsx"]);
  });

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
