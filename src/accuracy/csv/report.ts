import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPerson } from "./layouts";
import { generateCsvPeople, monthEnds, netWorthOn, type CsvPerson, type CsvSet } from "./people";
import { FINDING_TYPES, precision, recall, scorePerson, summarize, type CsvScoreboard, type PersonScore } from "./score";

// The CSV bench's tables, baseline and checked-in files, shared by `npm run accuracy`
// (./scoreboard.cli.test.ts) and the CI gate (./csv-accuracy.test.ts).

export const CSV_SETS: readonly CsvSet[] = ["tuning", "held-out"];
export const CSV_FIXTURES = "src/accuracy/csv/__fixtures__";
export const CSV_BASELINE = "src/accuracy/csv/baseline.json";

export async function scoreSet(set: CsvSet): Promise<{ people: CsvPerson[]; scores: PersonScore[]; board: CsvScoreboard }> {
  const people = generateCsvPeople(undefined, set);
  const scores: PersonScore[] = [];
  for (const p of people) scores.push(await scorePerson(p));
  return { people, scores, board: summarize(scores) };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

// The numbers the gate holds, as shares (higher is better unless the name says error).
export function headline(b: CsvScoreboard) {
  return {
    rowsReadExactly: b.parse.rowsExact / b.parse.truthRows,
    extraRows: b.parse.extra,
    categoryRight: b.category.right / b.category.of,
    ...Object.fromEntries(
      FINDING_TYPES.flatMap((t) => [
        [`${t}.precision`, Number(precision(b.findings[t]).toFixed(4))],
        [`${t}.recall`, Number(recall(b.findings[t]).toFixed(4))],
      ]),
    ),
    falseDoubleCharges: b.falseDoubleCharges.count,
    dollarError: b.dollars.truth ? b.dollars.absError / b.dollars.truth : 0,
    spendingError: b.spendingError,
    incomeError: b.incomeError,
    netWorthRight: b.netWorth.right / b.people,
    lineCoverage: b.line.coverage,
  };
}

export function table(set: CsvSet, b: CsvScoreboard): string {
  const f = (t: (typeof FINDING_TYPES)[number]) => {
    const x = b.findings[t];
    return `| ${t} | ${pct(precision(x))} | ${pct(recall(x))} | ${x.tp} | ${x.fp} | ${x.fn} |`;
  };
  return [
    `${set === "tuning" ? "Tuning set" : "Held-out set"} (${b.people} people, ${b.files} files, ${b.parse.truthRows} transactions):`,
    "",
    "| Step | Score |",
    "| --- | ---: |",
    `| Files read | ${b.files - b.parse.filesFailed} of ${b.files} (${b.parse.filesExact} exactly) |`,
    `| Rows read exactly | ${pct(b.parse.rowsExact / b.parse.truthRows)} (${b.parse.extra} extra, ${b.parse.missing} missing) |`,
    `| Category right (rules only) | ${pct(b.category.right / b.category.of)} (${b.category.uncategorized} left for Claude) |`,
    `| False "Charged twice?" | ${b.falseDoubleCharges.count} (${b.falseDoubleCharges.people} people) |`,
    `| Findings, $/yr | Jane ${dollars(b.dollars.jane)}, truth ${dollars(b.dollars.truth)}; error on the ones found ${pct(b.dollars.truth ? b.dollars.absError / b.dollars.truth : 0)} |`,
    `| Monthly spending, error | ${pct(b.spendingError)} |`,
    `| Monthly income, error | ${pct(b.incomeError)} |`,
    `| Net worth today right | ${b.netWorth.right} of ${b.people} people (off by ${dollars(b.netWorth.absError)} in all) |`,
    `| Net worth line: month-ends drawn | ${pct(b.line.coverage)} (error where drawn ${pct(b.line.error)}) |`,
    "",
    "| Finding | Precision | Recall | Right | False alarms | Missed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...FINDING_TYPES.map(f),
    "",
    `Missed subscriptions Claude would be asked about on a live upload: ${b.subscriptionsForClaude} of ${b.findings.subscription_review.fn}.`,
  ].join("\n");
}

// What a person should see, for checking an upload by hand.
export function truthOf(p: CsvPerson) {
  return {
    person: p.id,
    archetype: p.archetype,
    asOf: p.asOf,
    accounts: p.accounts.map((a) => ({ name: a.name, layout: a.layout, kind: a.kind, typesBalance: a.typesBalance })),
    findings: p.truth.findings.map((f) => ({ type: f.type, about: f.note, perYear: f.annualCents === null ? null : f.annualCents / 100 })),
    notFindings: p.truth.traps.map((t) => ({ type: t.type, about: t.note })),
    netWorthByMonthEnd: monthEnds(p).map((d) => ({ date: d, dollars: netWorthOn(p, d) / 100 })),
  };
}

// The files as checked in: one folder per person, the statements and what they should show.
export function fixtureFiles(set: CsvSet): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of generateCsvPeople(undefined, set)) {
    for (const f of renderPerson(p)) out.set(join(set, p.id, f.name), f.text);
    out.set(join(set, p.id, "truth.json"), `${JSON.stringify(truthOf(p), null, 2)}\n`);
  }
  return out;
}

export function writeFixtures(set: CsvSet) {
  rmSync(join(CSV_FIXTURES, set), { recursive: true, force: true });
  for (const [path, text] of fixtureFiles(set)) {
    mkdirSync(join(CSV_FIXTURES, path, ".."), { recursive: true });
    writeFileSync(join(CSV_FIXTURES, path), text);
  }
}

export function readFixtures(set: CsvSet): Map<string, string> {
  const out = new Map<string, string>();
  for (const person of readdirSync(join(CSV_FIXTURES, set))) {
    for (const name of readdirSync(join(CSV_FIXTURES, set, person))) {
      out.set(join(set, person, name), readFileSync(join(CSV_FIXTURES, set, person, name), "utf8"));
    }
  }
  return out;
}
