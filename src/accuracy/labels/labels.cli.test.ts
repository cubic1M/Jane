import { describe, expect, it, vi } from "vitest";
import { prepare, score, sealSheets } from "./run";

// The founders' commands (docs/accuracy.md, "Hand-labelled transactions"): LABELS_STEP says which.
// Off unless asked for, so it never runs in CI. Claude is stubbed: this spends nothing.
vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));

const step = process.env.LABELS_STEP;

describe.runIf(step)("hand-labelled transactions", () => {
  const dir = process.env.LABELS_DIR ?? "";
  const key = process.env.LABELS_KEY ?? "";

  it(`runs ${step}`, async () => {
    if (!dir) throw new Error("Set LABELS_DIR to the folder outside the repo.");
    if (step === "prepare") return console.log(prepare(dir));
    if (!key) throw new Error("Set LABELS_KEY.");
    if (step === "seal") return console.log(sealSheets(dir, key));
    const { table, drops } = await score(dir, key, {
      keepScores: process.env.LABELS_KEEP_SCORES === "1",
    });
    console.log(table);
    for (const drop of drops) console.log(`DROP: ${drop}`);
    expect(drops).toEqual([]);
  });
});
