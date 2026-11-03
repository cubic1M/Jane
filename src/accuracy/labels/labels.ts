import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PFC_TAXONOMY, type PfcPrimary } from "@/categorize/taxonomy";

// Real accuracy: the founders' own transactions, labelled by hand by both of them, scored by
// category. The labelled rows are people's real money, so they live in one sealed file outside
// this public repo, and what comes out of here is scores: counts and percentages per category,
// never a date, an amount or a description. docs/accuracy.md, "Hand-labelled transactions".

export type SheetRow = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  bankCategory?: string;
  bankType?: string;
};

// One row with what each founder said, on the rows both have seen.
export type LabelledRow = SheetRow & { a: string; b: string };

export const UNSURE = "UNSURE";
export const CATEGORIES = Object.keys(PFC_TAXONOMY) as PfcPrimary[];

export const rowId = (r: Omit<SheetRow, "id">, occurrence: number) =>
  createHash("sha256")
    .update(`${r.date}|${r.amountCents}|${r.description}|${occurrence}`)
    .digest("hex")
    .slice(0, 16);

// --- Keeping it outside the repo, sealed ------------------------------------------------------

export function isInsideRepo(path: string): boolean {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return true;
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

export function outsideRepo(path: string): string {
  if (isInsideRepo(path)) {
    throw new Error("The labels stay outside the repo: this repo is public. Pick another folder.");
  }
  return path;
}

const VERSION = "jane-labels-v1";
const keyOf = (base64: string) => {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("LABELS_KEY has to be 32 bytes, base64.");
  return key;
};

export function seal(rows: readonly LabelledRow[], base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(base64Key), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(rows), "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function unseal(sealed: string, base64Key: string): LabelledRow[] {
  const [version, iv, tag, body] = sealed.trim().split(".");
  if (version !== VERSION || !iv || !tag || !body)
    throw new Error("This isn't a sealed label file.");
  const decipher = createDecipheriv("aes-256-gcm", keyOf(base64Key), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const text = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
  return JSON.parse(text.toString("utf8")) as LabelledRow[];
}

// --- The two founders' sheets -----------------------------------------------------------------

export type Joined = { rows: LabelledRow[]; onlyOne: number; badLabels: string[] };

// Rows both founders labelled. A label that's no category is named with the row's id, so it can be
// fixed: nothing from the row itself is said.
export function joinSheets(
  sheet: readonly (SheetRow & { label: string })[],
  other: readonly { id: string; label: string }[],
): Joined {
  const known = new Set<string>([...CATEGORIES, UNSURE]);
  const theirs = new Map(other.map((r) => [r.id, r.label.trim().toUpperCase()]));
  const badLabels: string[] = [];
  const rows: LabelledRow[] = [];
  let onlyOne = 0;
  for (const { label, ...row } of sheet) {
    const a = label.trim().toUpperCase();
    const b = theirs.get(row.id);
    if (!a || !b) {
      if (a || b) onlyOne += 1;
      continue;
    }
    for (const said of [a, b]) if (!known.has(said)) badLabels.push(`${row.id}: ${said}`);
    rows.push({ ...row, a, b });
  }
  return { rows, onlyOne, badLabels };
}

// --- Scores -----------------------------------------------------------------------------------

export type CategoryScore = {
  category: string;
  // Rows truly in it, and what Jane said about them.
  support: number;
  said: number;
  right: number;
  precision: number | null;
  recall: number | null;
};

export type LabelScores = {
  labelled: number;
  // Both founders said the same: the truth scored against. The rest are scored by nobody.
  agreed: number;
  disagreed: number;
  unsure: number;
  // How far past chance the founders agree (Cohen's kappa).
  kappa: number | null;
  // Rows the rules left unsorted: on the real path those go to Claude, which this doesn't call.
  unsorted: number;
  accuracy: number | null;
  // Each category counts the same here, so a rare one can't hide behind a common one.
  macroRecall: number | null;
  categories: CategoryScore[];
};

const share = (part: number, whole: number) => (whole === 0 ? null : part / whole);

export function cohensKappa(pairs: readonly (readonly [string, string])[]): number | null {
  if (pairs.length === 0) return null;
  const observed = pairs.filter(([a, b]) => a === b).length / pairs.length;
  const count = (side: 0 | 1) => {
    const seen = new Map<string, number>();
    for (const pair of pairs) seen.set(pair[side], (seen.get(pair[side]) ?? 0) + 1);
    return seen;
  };
  const [as, bs] = [count(0), count(1)];
  let expected = 0;
  for (const [label, n] of as)
    expected += (n / pairs.length) * ((bs.get(label) ?? 0) / pairs.length);
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

export function scoreLabels(
  rows: readonly LabelledRow[],
  predicted: ReadonlyMap<string, string | null>,
): LabelScores {
  const clear = rows.filter((r) => r.a !== UNSURE && r.b !== UNSURE);
  const agreed = clear.filter((r) => r.a === r.b);
  const said = new Map<string, number>();
  const truth = new Map<string, number>();
  const right = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  let unsorted = 0;
  let correct = 0;
  for (const row of agreed) {
    bump(truth, row.a);
    const guess = predicted.get(row.id) ?? null;
    if (guess === null) {
      unsorted += 1;
      continue;
    }
    bump(said, guess);
    if (guess === row.a) {
      bump(right, row.a);
      correct += 1;
    }
  }
  const categories = [...new Set([...truth.keys(), ...said.keys()])].sort().map((category) => {
    const r = right.get(category) ?? 0;
    return {
      category,
      support: truth.get(category) ?? 0,
      said: said.get(category) ?? 0,
      right: r,
      precision: share(r, said.get(category) ?? 0),
      recall: share(r, truth.get(category) ?? 0),
    };
  });
  const recalls = categories.flatMap((c) => (c.recall === null ? [] : [c.recall]));
  return {
    labelled: rows.length,
    agreed: agreed.length,
    disagreed: clear.length - agreed.length,
    unsure: rows.length - clear.length,
    kappa: cohensKappa(clear.map((r) => [r.a, r.b] as const)),
    unsorted,
    accuracy: share(correct, agreed.length),
    macroRecall: share(
      recalls.reduce((sum, r) => sum + r, 0),
      recalls.length,
    ),
    categories,
  };
}

// A fall of this many points in any one category's precision or recall is a drop.
export const DROP_POINTS = 3;

export function drops(before: LabelScores, now: LabelScores): string[] {
  const out: string[] = [];
  const old = new Map(before.categories.map((c) => [c.category, c]));
  for (const c of now.categories) {
    const was = old.get(c.category);
    if (!was) continue;
    for (const metric of ["precision", "recall"] as const) {
      const [a, b] = [was[metric], c[metric]];
      if (a !== null && b !== null && (a - b) * 100 >= DROP_POINTS) {
        out.push(`${c.category} ${metric} fell from ${pct(a)} to ${pct(b)}`);
      }
    }
  }
  return out;
}

const pct = (n: number | null) => (n === null ? "-" : `${(n * 100).toFixed(1)}%`);

// The only thing this module prints.
export function scoreTable(s: LabelScores): string {
  const lines = [
    `Labelled ${s.labelled}: ${s.agreed} agreed, ${s.disagreed} disagreed, ${s.unsure} unsure. Founders' agreement (kappa): ${s.kappa === null ? "-" : s.kappa.toFixed(2)}.`,
    `Accuracy ${pct(s.accuracy)}, with each category counted the same ${pct(s.macroRecall)}. Left for Claude: ${s.unsorted}.`,
    "",
    "| Category | Rows | Jane said | Right | Precision | Recall |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...[...s.categories]
      // The weakest first: that's what this is for.
      .sort((a, b) => (a.recall ?? 2) - (b.recall ?? 2) || a.category.localeCompare(b.category))
      .map(
        (c) =>
          `| ${c.category} | ${c.support} | ${c.said} | ${c.right} | ${pct(c.precision)} | ${pct(c.recall)} |`,
      ),
  ];
  return lines.join("\n");
}
