import { readFileSync, writeFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import { CSV_BASELINE, CSV_SETS, headline, scoreSet, table, writeFixtures } from "./report";

// `npm run accuracy`, the CSV half (docs/accuracy.md, "CSV bench"): every step of the upload
// path scored on the tuning and held-out sets. ACCURACY_WRITE=1 also rewrites the checked-in
// files, the baseline the gate holds to and the tables in docs/accuracy.md. ACCURACY_MISTAKES=1
// lists the tuning sets' mistakes, the ones to fix rules on; never the held-out set's. Claude is
// stubbed: the bench scores the rules alone and spends nothing.
vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));

const DOC = "docs/accuracy.md";

describe.runIf(process.env.ACCURACY === "1")("the CSV accuracy scoreboard", () => {
  it("scores the upload path on the labelled statements", async () => {
    const write = process.env.ACCURACY_WRITE === "1";
    const baseline: Record<string, ReturnType<typeof headline>> = {};
    const doc: string[] = [];
    for (const set of CSV_SETS) {
      if (write) writeFixtures(set);
      const { scores, board } = await scoreSet(set);
      const text = table(set, board);
      console.log(`CSV bench, ${text}\n`);
      if (set.startsWith("tuning") && process.env.ACCURACY_MISTAKES === "1") {
        for (const s of scores)
          for (const m of s.mistakes) console.log(`${m.what} ${m.kind} ${m.person} ${m.detail}`);
      }
      baseline[set] = headline(board);
      doc.push(text, "");
    }
    if (write) {
      writeFileSync(CSV_BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
      const start = "<!-- csv-scoreboard:start -->";
      const end = "<!-- csv-scoreboard:end -->";
      const current = readFileSync(DOC, "utf8");
      writeFileSync(
        DOC,
        current.replace(
          new RegExp(`${start}[\\s\\S]*${end}`),
          `${start}\n${doc.join("\n").trimEnd()}\n${end}`,
        ),
      );
    }
  }, 300_000);
});
