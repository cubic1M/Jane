import { describe, expect, it, vi } from "vitest";
import baseline from "./baseline.json";
import { CSV_SETS, fixtureFiles, headline, readFixtures, scoreSet } from "./report";

// The CSV bench's gate (docs/accuracy.md, "CSV bench"), run with the unit tests: the upload
// path, scored on both sets of labelled statements, may not slip more than ALLOWED_DROP below
// the recorded baseline (./baseline.json, written by `ACCURACY_WRITE=1 npm run accuracy`), and
// no new false "Charged twice?" or extra rows may appear. A change that does better passes;
// record the new baseline with it. Claude is stubbed: the rules alone are scored.
vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));

const ALLOWED_DROP = 0.03;
// Counts and errors, where lower is better.
const LOWER_IS_BETTER = new Set([
  "extraRows",
  "falseDoubleCharges",
  "dollarError",
  "spendingError",
  "incomeError",
]);

describe.each(CSV_SETS)("the CSV bench's %s set", (set) => {
  it("is the generator's output, so the files can't drift from their truth", () => {
    const want = fixtureFiles(set);
    const have = readFixtures(set);
    expect([...have.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [path, text] of want) expect(have.get(path), path).toBe(text);
  });

  it("keeps every step of the upload path at its baseline", async () => {
    const now = headline((await scoreSet(set)).board) as Record<string, number>;
    const base = baseline[set] as Record<string, number>;
    for (const [name, was] of Object.entries(base)) {
      if (LOWER_IS_BETTER.has(name)) {
        const slack = Number.isInteger(was) ? 0 : ALLOWED_DROP;
        expect(now[name], name).toBeLessThanOrEqual(was + slack);
      } else {
        expect(now[name], name).toBeGreaterThanOrEqual(was - ALLOWED_DROP);
      }
    }
  }, 120_000);
});
