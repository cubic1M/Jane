import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { categorizeTransactions } from "@/categorize/categorize";
import type { NormalizedTransaction } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";
import {
  CATEGORIES,
  UNSURE,
  drops,
  joinSheets,
  outsideRepo,
  scoreLabels,
  scoreTable,
  seal,
  unseal,
  type LabelScores,
  type LabelledRow,
} from "./labels";
import { readSheet, sheetFromStatements } from "./sheet";

// The three steps the founders run (docs/accuracy.md): make the sheet, seal the two labelled
// copies, score. Everything is read from and written to one folder outside the repo. What's
// returned is what's printed: counts, category names and scores only.

export const SEALED = "labels.sealed";
export const SCORES = "scores.json";

const NO_RULES_DB = {
  userId: "labels",
  merchantCategories: {
    findMany: async () => [],
    createMany: async () => ({ count: 0 }),
  },
} as unknown as Pick<ScopedDb, "userId" | "merchantCategories">;

export function prepare(dir: string): string {
  outsideRepo(dir);
  const statements = join(dir, "statements");
  mkdirSync(statements, { recursive: true });
  const files = readdirSync(statements).map((name) => ({
    name,
    text: readFileSync(join(statements, name), "utf8"),
  }));
  const { sheet, rows, unread } = sheetFromStatements(files);
  writeFileSync(join(dir, "to-label.csv"), sheet, { mode: 0o600 });
  return [
    `${rows} rows from ${files.length - unread.length} files in to-label.csv.`,
    ...(unread.length > 0 ? [`Couldn't read ${unread.length} files: ${unread.join(", ")}`] : []),
    `Labels: ${[...CATEGORIES, UNSURE].join(", ")}`,
  ].join("\n");
}

export function sealSheets(dir: string, key: string): string {
  outsideRepo(dir);
  const sheetA = readSheet(readFileSync(join(dir, "labels-a.csv"), "utf8"));
  const sheetB = readSheet(readFileSync(join(dir, "labels-b.csv"), "utf8"));
  const { rows, onlyOne, badLabels } = joinSheets(sheetA, sheetB);
  if (badLabels.length > 0) {
    throw new Error(`These labels aren't categories (row id: label):\n${badLabels.join("\n")}`);
  }
  writeFileSync(join(dir, SEALED), seal(rows, key), { mode: 0o600 });
  return `Sealed ${rows.length} rows labelled by both, in ${SEALED}. ${onlyOne} were labelled by only one. Now delete statements/, to-label.csv, labels-a.csv and labels-b.csv.`;
}

// The rules alone, with no merchant cache and no Claude, as a new person's first upload sorts.
export async function predict(rows: readonly LabelledRow[]): Promise<Map<string, string | null>> {
  const incoming = rows.map((r): NormalizedTransaction => ({
    accountRef: "labels",
    date: r.date,
    amountCents: r.amountCents,
    description: r.description,
    merchantName: null,
    categoryPrimary: null,
    categoryDetailed: null,
    pending: false,
    externalId: r.id,
    hints: {
      ...(r.bankCategory ? { bankCategory: r.bankCategory } : {}),
      ...(r.bankType ? { bankType: r.bankType } : {}),
    },
  }));
  const sorted = await categorizeTransactions(incoming, NO_RULES_DB, { askClaude: false });
  return new Map(sorted.map((t) => [t.externalId, t.category?.primary ?? null]));
}

export async function score(
  dir: string,
  key: string,
  { keepScores = false }: { keepScores?: boolean } = {},
): Promise<{ table: string; drops: string[]; scores: LabelScores }> {
  outsideRepo(dir);
  const rows = unseal(readFileSync(join(dir, SEALED), "utf8"), key);
  const scores = scoreLabels(rows, await predict(rows));
  let fell: string[] = [];
  try {
    const before = JSON.parse(readFileSync(join(dir, SCORES), "utf8")) as LabelScores;
    // Scores against other labels say nothing about the rules.
    if (before.labelled === scores.labelled) fell = drops(before, scores);
  } catch {
    // No scores kept yet: this run is the first.
  }
  if (keepScores) writeFileSync(join(dir, SCORES), JSON.stringify(scores, null, 2));
  return { table: scoreTable(scores), drops: fell, scores };
}
