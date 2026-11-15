import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-15: "Renters insurance, Missing" showed its reason, then More showed the same two
// sentences again; "Driving for pay?" repeated its first two before adding the third. The tree's
// summary for a gap is its why and for a question its riskQuestion (src/lib/area-pages/
// insurance.ts, cut to the first sentences), so More may carry only what that summary leaves
// out, never the whole text again.

const page = readFileSync(join(__dirname, "page.tsx"), "utf8");

// Each `more[…] = …;` statement's right-hand side, with its line.
const moreAssignments = (source: string) =>
  [...source.matchAll(/more\[[^\]]+\]\s*=\s*([\s\S]*?);\n/g)].map((m) => ({
    line: source.slice(0, m.index).split("\n").length,
    value: m[1]!.replace(/\s+/g, " ").trim(),
  }));

// The texts the tree already shows as a gap's or a question's summary.
const SUMMARY_TEXTS = [/^<p>\{gap\.why\}<\/p>$/, /^<p>\{riskQuestion\(r\)\}<\/p>$/];

describe("an insurance card's More", () => {
  it("never says its summary again in full", () => {
    const repeats = moreAssignments(page)
      .filter(({ value }) => SUMMARY_TEXTS.some((re) => re.test(value)))
      .map(({ line, value }) => `page.tsx:${line} ${value}`);
    expect(repeats).toEqual([]);
  });

  it("finds the page's More texts at all", () => {
    expect(moreAssignments(page).length).toBeGreaterThan(3);
  });
});
