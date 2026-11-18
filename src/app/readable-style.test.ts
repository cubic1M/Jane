import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The readable style (founder, 2026-11-18: "it looks like a terminal"): the sans font and solid
// lines on every page but the landing, no "> " or "# " before headings, an error that says
// "Error:" in words, and the corner shape in one rule that nothing else depends on (the founder
// may yet compare it with rounded corners).

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
// Each rule's selector and body, comments dropped.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  ([, selector, body]) => ({ selector: selector.trim().replace(/\s+/g, " "), body }),
);

describe("the readable style", () => {
  it("sets the sans font on the page, with figures one width", () => {
    // The last body rule with a font wins.
    const body = rules.findLast((r) => r.selector === "body" && /font-family/.test(r.body))!;
    expect(body.body).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(body.body).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("keeps monospace, dashed lines and heading marks to the landing page", () => {
    for (const rule of rules) {
      const landing = rule.selector.split(",").every((s) => s.trim().startsWith(".landing"));
      if (
        /font-family:\s*var\(--font-mono\)/.test(rule.body) &&
        !/code|kbd|pre/.test(rule.selector)
      )
        expect(landing, rule.selector).toBe(true);
      if (/--tw-border-style:\s*dashed/.test(rule.body)) expect(landing, rule.selector).toBe(true);
      if (/content:\s*"(> |# )"/.test(rule.body)) expect(landing, rule.selector).toBe(true);
    }
  });

  it("says Error: in words before an error, not [ERROR]", () => {
    expect(css).not.toContain("[ERROR]");
    const tag = rules.find(
      (r) => r.selector.includes('[role="alert"]') && /::before/.test(r.selector),
    )!;
    expect(tag.body).toMatch(/content:\s*"Error: "/);
  });

  it("sets the corner shape in one rule and nowhere else", () => {
    const shaped = rules.filter((r) => /border-radius/.test(r.body));
    expect(shaped.map((r) => r.selector)).toEqual(["*, *::before, *::after"]);
    expect(shaped[0].body).toMatch(/border-radius:\s*0 !important/);
  });
});
