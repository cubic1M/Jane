import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { EXPLAINERS, REVIEW_NOTE } from "./learn";

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

// The /learn pages were removed (founder, 2026-10-26): the chat answers "what's an index fund?"
// with the explainer itself, and nothing links to a page that's gone.
function learnLinks(dir = join(process.cwd(), "src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : learnLinks(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/["`]\/learn(?:\/[a-z-]*)?["`?#]/g)].map((m) => `${path}: ${m[0]}`);
  });
}

describe("the explainers", () => {
  it("have no pages, and nothing links to one", () => {
    expect(learnLinks()).toEqual([]);
  });
});
