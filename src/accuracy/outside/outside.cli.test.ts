import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { categorizeByRules } from "@/categorize/rules";
import { categoryOf } from "@/categorize/taxonomy";
import { parseCsv } from "@/data-sources/csv/parse-csv";
import type { NormalizedTransaction } from "@/data-sources/types";

// A bench someone else wrote (docs/accuracy.md, "An outside bench"): DoDataThings' 68,000 made-up US
// bank lines, MIT, from huggingface.co/datasets/DoDataThings/us-bank-transaction-categories-v2 at
// commit 3e8d052cb7b362fb1a04b6064d2331982553ea56. Its rows aren't in this repo, and this prints a score per
// category and never a row, so that nobody tunes the rules on it. Skipped in a normal run. To score:
// download its transactions-synthetic.csv outside the repo, then
// OUTSIDE_BENCH_CSV=/path/to/transactions-synthetic.csv npx vitest run src/accuracy/outside --silent=false

// Its 17 categories, as the Plaid primaries that would be right. Its "Subscription" names no kind of
// thing, so either of the two a plan is filed under counts.
const RIGHT_PRIMARIES: Record<string, readonly string[]> = {
  Restaurants: ["FOOD_AND_DRINK"],
  Groceries: ["FOOD_AND_DRINK"],
  Shopping: ["GENERAL_MERCHANDISE", "HOME_IMPROVEMENT"],
  Transportation: ["TRANSPORTATION"],
  Entertainment: ["ENTERTAINMENT"],
  Utilities: ["RENT_AND_UTILITIES"],
  Subscription: ["ENTERTAINMENT", "GENERAL_SERVICES"],
  Healthcare: ["MEDICAL"],
  Insurance: ["GENERAL_SERVICES"],
  Mortgage: ["LOAN_PAYMENTS"],
  Rent: ["RENT_AND_UTILITIES"],
  Travel: ["TRAVEL"],
  Education: ["GENERAL_SERVICES"],
  "Personal Care": ["PERSONAL_CARE"],
  Transfer: ["TRANSFER_IN", "TRANSFER_OUT"],
  Income: ["INCOME"],
  Fees: ["BANK_FEES"],
};

// "[debit] PP*SAFEWAY": its lines have a direction and no amount, so rules that weigh an amount see
// this one.
const NOMINAL_CENTS = 5000;

function row(line: string): NormalizedTransaction | null {
  const match = /^\[(debit|credit)\]\s*(.*)$/.exec(line);
  if (!match) return null;
  return {
    accountRef: "outside",
    date: "2026-10-01",
    amountCents: match[1] === "debit" ? NOMINAL_CENTS : -NOMINAL_CENTS,
    description: match[2]!,
    merchantName: null,
    categoryPrimary: null,
    categoryDetailed: null,
    pending: false,
    externalId: line,
    hints: {},
  };
}

const pct = (part: number, whole: number) => `${((part / Math.max(1, whole)) * 100).toFixed(1)}%`;

describe.runIf(process.env.OUTSIDE_BENCH_CSV)("the outside bench", () => {
  it("scores the rules, per category and no rows", () => {
    const records = parseCsv(readFileSync(process.env.OUTSIDE_BENCH_CSV!, "utf8"));
    const tally = new Map<string, { rows: number; right: number; none: number }>();
    for (const { fields } of records.slice(1)) {
      const [description, category] = fields;
      const t = row(description ?? "");
      const wanted = RIGHT_PRIMARIES[category ?? ""];
      if (!t || !wanted) throw new Error("A row this bench can't read: its file has changed.");
      const entry = tally.get(category!) ?? { rows: 0, right: 0, none: 0 };
      const got = categorizeByRules(t);
      const primary = got ? categoryOf(got.detailed)?.primary : null;
      entry.rows += 1;
      if (!primary) entry.none += 1;
      else if (wanted.includes(primary)) entry.right += 1;
      tally.set(category!, entry);
    }
    const all = [...tally.values()].reduce(
      (s, t) => ({ rows: s.rows + t.rows, right: s.right + t.right, none: s.none + t.none }),
      { rows: 0, right: 0, none: 0 },
    );
    const line = (name: string, t: { rows: number; right: number; none: number }) =>
      `| ${name} | ${t.rows} | ${pct(t.right, t.rows)} | ${pct(t.none, t.rows)} | ${pct(t.rows - t.right - t.none, t.rows)} |`;
    console.log(
      [
        "| Category | Rows | Right | Left for Claude | Wrong |",
        "| --- | ---: | ---: | ---: | ---: |",
        line("All", all),
        ...[...tally].sort(([a], [b]) => a.localeCompare(b)).map(([name, t]) => line(name, t)),
      ].join("\n"),
    );
  }, 300_000);
});
