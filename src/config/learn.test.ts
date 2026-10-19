import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { EXPLAINERS, FINDING_EXPLAINERS, REVIEW_NOTE, explainer } from "./learn";

// Spec step 136: each explainer is reviewed text; every link resolves.

const textOf = (e: (typeof EXPLAINERS)[number]) => [e.summary, ...e.paragraphs].join(" ");

describe("the explainers", () => {
  it("cover the eight topics, each once", () => {
    expect(EXPLAINERS.map((e) => e.slug)).toEqual([
      "index-funds",
      "fees",
      "the-match",
      "roth-vs-traditional",
      "rebalancing",
      "refinancing",
      "deductibles",
      "standard-deduction",
    ]);
  });

  it("are checked text: a review status, sources, short paragraphs", () => {
    for (const e of EXPLAINERS) {
      expect(["awaiting_counsel", "reviewed"]).toContain(e.review.status);
      if (e.review.status === "reviewed") expect(e.review.reviewedBy).toBeTruthy();
      expect(e.review.writtenOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.sources.length, e.slug).toBeGreaterThan(0);
      expect(e.paragraphs.length, e.slug).toBeGreaterThanOrEqual(2);
      for (const p of e.paragraphs) expect(p.length, p).toBeLessThan(400);
      expect(e.summary.endsWith("."), e.slug).toBe(true);
    }
    expect(REVIEW_NOTE).toMatch(/waiting for review by counsel/);
  });

  it("never promise an outcome, never tell the reader what to do, and give no legal advice", () => {
    for (const e of EXPLAINERS) {
      const text = textOf(e);
      const check = checkGuardrails(
        text,
        dollarFigures(text).map((f) => f.cents),
        undefined,
        "demo_advice",
      );
      expect(check, e.slug).toEqual({ ok: true });
      expect(recommendsAChoice(text), e.slug).toBe(false);
      expect(text, e.slug).not.toMatch(/\byou should\b/i);
    }
  });
});

// Every page under src that links to an explainer, by slug.
function linkedSlugs(dir = join(process.cwd(), "src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return linkedSlugs(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    const source = readFileSync(path, "utf8");
    return [
      ...[...source.matchAll(/learnLink\("([a-z-]+)"\)/g)].map((m) => m[1]),
      ...[...source.matchAll(/["`]\/learn\/([a-z][a-z-]+)["`]/g)].map((m) => m[1]),
      ...[
        ...source.matchAll(/"(index-funds|fees|the-match|roth-vs-traditional|rebalancing)"/g),
      ].map((m) => m[1]),
    ];
  });
}

describe("every link to an explainer resolves", () => {
  it("in the app's code", () => {
    const slugs = new Set(linkedSlugs());
    expect(slugs.size).toBeGreaterThan(4);
    for (const slug of slugs) expect(explainer(slug), slug).not.toBeNull();
  });

  it("from finding cards", () => {
    for (const slug of Object.values(FINDING_EXPLAINERS))
      expect(explainer(slug), slug).not.toBeNull();
  });
});
