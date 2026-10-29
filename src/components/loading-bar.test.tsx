import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingBar } from "./loading-bar";

// The loading bar (founder: "it should always show a loading bar as well instead of the simple
// 'Loading xxx....'"): the ASCII bar in the flow, and no page waiting behind plain words.

const SRC = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("the loading bar", () => {
  it("is an ASCII progress bar with its words, in the flow (nothing fixed over the page)", () => {
    const html = renderToStaticMarkup(<LoadingBar label="Loading taxes" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Loading taxes"');
    expect(html).toMatch(/\[[█░]{16}\] 8% · loading taxes/);
    expect(html).not.toMatch(/\b(fixed|absolute)\b/);
  });

  it("stands in for every page's loading words", () => {
    const plain: string[] = [];
    for (const f of files(SRC)) {
      const code = readFileSync(f, "utf8");
      for (const m of code.matchAll(/fallback=\{\s*<p[^>]*>[^<]*<\/p>\s*\}/g)) {
        plain.push(`${relative(SRC, f)}: ${m[0]}`);
      }
    }
    expect(plain).toEqual([]);
  });

  it("is never plain loading words in a page", () => {
    const plain = files(SRC).filter((f) =>
      />\s*Loading(…|\.\.\.)\s*</.test(readFileSync(f, "utf8")),
    );
    expect(plain.map((f) => relative(SRC, f))).toEqual([]);
  });

  // Reviewer polish: a page's own fallback keeps the top bar, so the page doesn't draw full width
  // and then jump under the bar and beside the docked chat.
  it("comes with the top bar on every signed-in page", () => {
    const bare: string[] = [];
    for (const f of files(join(SRC, "app"))) {
      if (!f.endsWith("page.tsx")) continue;
      const code = readFileSync(f, "utf8");
      if (!code.includes("<AppHeader")) continue;
      const page = code.slice(code.indexOf("export default"));
      if (/<Suspense\s+fallback=\{<LoadingBar/.test(page)) bare.push(relative(SRC, f));
    }
    expect(bare).toEqual([]);
  });
});
