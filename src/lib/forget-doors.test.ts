import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Forget means gone, in every table, whichever door the person goes through. A told answer lives in
// jane_preferences / user_facts, in a copy in another table (src/lib/told-mirrors.ts) and in the
// household's tax record (src/lib/tax-facts/); the one place a told preference is deleted
// (deletePreference) and the two memory functions that delete facts (forgetFact, forgetEverything)
// clean all of those. This lists every file that deletes from the two tables, with how many deletes
// and why it is not a person taking a told answer back. A new delete outside the list is a failing
// test: send it through deletePreference (or forgetFact), or list it here with its reason.
const KNOWN: Record<string, { deletes: number; why: string }> = {
  "lib/jane-agent/preferences.ts": {
    deletes: 2,
    why: "deletePreference, the shared door: also clears the tax record (forgetToldRecord)",
  },
  "lib/memory/facts.ts": {
    deletes: 6,
    why: "forgetFact and forgetEverything (both call forgetToldRecord); the tombstone swap in recordFact; forgetFactsFrom (no caller)",
  },
  "lib/evidence/orphans.ts": {
    deletes: 3,
    why: "removing an upload or a bank: facts from a detector or an upload, and the saved primer, never a told answer",
  },
  "lib/debt-plan.ts": { deletes: 1, why: "a 'never' preference (stop suggesting), not a fact" },
  "lib/suggestion-take-back.ts": {
    deletes: 1,
    why: "the habit row a 'no' made, not a told profile fact",
  },
  "lib/import/separate.ts": { deletes: 1, why: "the keep-this-upload-separate preference" },
};

const DELETE = /\b(?:janePreferences?|userFacts?)\s*\.\s*(?:delete|deleteMany)\s*\(/g;
const SRC = join(process.cwd(), "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const functionBody = (text: string, name: string) => {
  const start = text.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = text.indexOf("\nexport ", start + 10);
  return text.slice(start, next === -1 ? undefined : next);
};

describe("every delete of what a person told Jane clears the tax record too", () => {
  it("only the listed files delete from jane_preferences or user_facts", () => {
    const found: Record<string, number> = {};
    for (const file of sources(SRC)) {
      const count = (readFileSync(file, "utf8").match(DELETE) ?? []).length;
      if (count > 0) found[relative(SRC, file)] = count;
    }
    const known = Object.fromEntries(Object.entries(KNOWN).map(([f, k]) => [f, k.deletes]));
    expect(found).toEqual(known);
  });

  it("deletePreference clears the household record itself", () => {
    const text = readFileSync(join(SRC, "lib/jane-agent/preferences.ts"), "utf8");
    expect(functionBody(text, "deletePreference")).toContain("forgetToldRecord(");
  });

  it("forgetFact and forgetEverything clear the household record", () => {
    const text = readFileSync(join(SRC, "lib/memory/facts.ts"), "utf8");
    expect(functionBody(text, "forgetFact")).toContain("forgetToldRecord(");
    expect(functionBody(text, "forgetEverything")).toContain("forgetToldRecord(");
  });
});
