import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MARCHING_LINE } from "@/config/motion";

// One marching dotted line (founder: "some are grey and some are white"): the CSS tokens are
// MARCHING_LINE's, and no line marches with a style of its own.

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("the marching dotted line", () => {
  it("has the config's colour and speed in the CSS", () => {
    expect(css).toContain(`--line-march: ${MARCHING_LINE.color};`);
    expect(css).toContain(`--line-march-period: ${MARCHING_LINE.periodMs}ms;`);
    const [dash, gap] = MARCHING_LINE.dash.split(" ").map(Number);
    expect(css).toMatch(new RegExp(`stroke-dashoffset: -${dash + gap};`));
  });

  it("is only ever drawn by MarchingPath", () => {
    const own: string[] = [];
    for (const f of files(SRC)) {
      const code = readFileSync(f, "utf8");
      // The class itself (not data-ask-line, the Ask Jane line's test hook).
      if (
        /(?<![-\w])(ask-line|marching-line)(?![-\w])/.test(code) &&
        !f.endsWith("marching-path.tsx")
      ) {
        own.push(relative(SRC, f));
      }
    }
    expect(own).toEqual([]);
  });
});
