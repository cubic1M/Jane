import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Manager 11-23: the backup chat's replies, and the card wording they quote, may say what something
// "could save about" (a figure the card works out), never promise it. Every string the backup can
// say (src/lib/jane-agent, the savings phrase, the detectors' cards) is read here; the system
// prompts, Claude's tool descriptions and the answer checks' bad examples aren't replies.

const PROMISE = /\b(?:will save|you'?ll save|you will save|saves you|guarantee[ds]?)\b/i;
// "with no guarantee" says the opposite.
const HEDGED = /\bno guarantee/i;
const NOT_REPLIES =
  /(?:\.test\.ts$|__fixtures__|\/checks\/|claude\.ts$|tools\.ts$|tool-select\.ts$)/;

function literals(file: string): { line: number; text: string }[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) {
      text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("…");
    }
    if (text) out.push({ line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

describe("the backup chat's words", () => {
  const files = [
    ...globSync("src/lib/jane-agent/**/*.ts"),
    "src/lib/savings-text.ts",
    ...globSync("src/detectors/*.ts"),
  ].filter((f) => !NOT_REPLIES.test(f));

  it("reads every reply file", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("never promise a saving", () => {
    const found = files.flatMap((f) =>
      literals(f)
        .filter(({ text }) => PROMISE.test(text) && !HEDGED.test(text))
        .map(({ line, text }) => `${f}:${line} ${text.slice(0, 100)}`),
    );
    expect(found).toEqual([]);
  });
});
