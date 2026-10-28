import { cardPaymentOutflows } from "@/categorize/card-payments";
import { categorizeTransactions } from "@/categorize/categorize";
import { categoryOf } from "@/categorize/taxonomy";
import { LOOKBACK_MONTHS } from "@/config/detection";
import { MERCHANT_SEED } from "@/config/merchant-seed";
import { mappingChoices, type ColumnMapping } from "@/data-sources/csv/column-mapping";
import { readCsvFile, type DayBalance } from "@/data-sources/csv/csv-source";
import { parseCsv } from "@/data-sources/csv/parse-csv";
import { normalizeDescription } from "@/data-sources/merchant";
import { ACCOUNT_KINDS } from "@/data-sources/types";
import { detect } from "@/detection/detect";
import { addDays, expectedDates, isComingUp } from "@/detection/forecast";
import { withDirectory } from "@/detection/merchants";
import { isAmbiguousRecurring } from "@/detection/rules/subscription-review";
import { buildStreams, merchantOf } from "@/detection/streams";
import type { Candidate, DetectionInput, DetectionTransaction } from "@/detection/types";
import { monthsBefore } from "@/detection/units";
import { netWorth, notCounting } from "@/insights/net-worth";
import { dailyNetWorth } from "@/insights/net-worth-series";
import { kindOf } from "@/insights/spending";
import type { ScopedDb } from "@/lib/db-scoped";
import { derivedBalances } from "@/lib/import/balances";
import { runDetectors } from "@/detectors";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { calibration, type Bucket, type Judged } from "../score";
import { renderPerson, type BenchFile } from "./layouts";
import { balanceOn, monthEnds, netWorthOn, type CsvPerson, type TrueFinding } from "./people";

// The CSV accuracy bench's scoring (docs/accuracy.md, "CSV bench"): each person's files go
// through the upload path as /import runs it, with no database and Claude switched off, and
// every step is scored against the person's truth (./people.ts).
//
// 1. Read: readCsvFile on each file (a file in no known layout gets Jane's own column guesses,
//    as if the person accepted the picker as it opened), one copy of each row kept as the
//    upload and the database's dedupe keys do.
// 2. Categorize: categorizeTransactions with askClaude off and an empty merchant cache, then
//    card payments matched from the card's side, as after every import.
// 3. Detect: the merchant directory's seed, then detect() and the recurring streams.
// 4. Numbers: the spending chart's monthly totals, net worth today and its line over time.

export const FINDING_TYPES: readonly TrueFinding["type"][] = [
  "subscription_review",
  "price_increase",
  "trial_conversion",
  "bank_fees",
  "card_interest",
  "duplicate_charge",
  "idle_cash",
];

type Row = DetectionTransaction & { truthId: string | null; pending: boolean };

// No user rules, no cached merchants: a new person's first upload.
const emptyDb = {
  userId: "csv-bench",
  merchantCategories: {
    findMany: async () => [],
    createMany: async () => ({ count: 0 }),
  },
} as unknown as Pick<ScopedDb, "userId" | "merchantCategories">;

// The bench's custom files are date, description, amount (money out negative), balance.
const CUSTOM_COLUMNS = { date: 0, description: 1, amount: 2 } as const;

// The column picker as the person fills it in: Jane's first guesses where it has them, and the
// right column where it asks (`asked` counts those).
export function pickedMapping(text: string): { mapping: ColumnMapping; asked: number } {
  const choices = mappingChoices(parseCsv(text));
  const { guess } = choices;
  let asked = 0;
  const or = (value: number | null, right: number) => {
    if (value === null) asked += 1;
    return value ?? right;
  };
  const date = or(guess.date, CUSTOM_COLUMNS.date);
  const description = or(guess.description, CUSTOM_COLUMNS.description);
  const column = or(guess.amount, CUSTOM_COLUMNS.amount);
  const sign = choices.signs[column]?.moneyOut ?? null;
  const moneyOut = sign ?? "negative";
  if (sign === null) asked += 1;
  const order = choices.dateOrders[date];
  return {
    mapping: {
      hasHeader: choices.hasHeader,
      date,
      description,
      amount: { kind: "signed", column, moneyOut },
      dateOrder: order && order !== "unknown" ? order : "dmy",
    },
    asked,
  };
}
const guessedMapping = (text: string) => pickedMapping(text).mapping;

export type Upload = {
  person: CsvPerson;
  files: BenchFile[];
  failedFiles: string[];
  rows: Row[];
  input: DetectionInput;
  findings: Candidate[];
  // Balances kept for the net worth line: the statements' own, then month ends worked back.
  snapshots: (DayBalance & { accountId: string })[];
  // Each account's latest balance in its own files, or null when they carry none.
  fileLatest: Record<string, number | null>;
};

const clean = (s: string) => normalizeDescription(s);

export async function runUpload(person: CsvPerson): Promise<Upload> {
  const files = renderPerson(person);
  const failedFiles: string[] = [];
  const rows: Row[] = [];
  // The truth row each description, date and amount on an account is.
  const truthBy = new Map<string, string[]>();
  for (const f of files) {
    for (const id of f.rows) {
      const t = person.rows.find((x) => x.id === id)!;
      const k = `${t.account}|${t.date}|${t.amountCents}|${clean(f.descriptions[id])}`;
      const ids = truthBy.get(k) ?? [];
      if (!ids.includes(id)) truthBy.set(k, [...ids, id]);
    }
  }
  const used = new Set<string>();
  let extra = 0;
  // Each account's closing balance by day, from the files' running-balance columns (later files
  // win, as an upload's batch keeps them).
  const fileBalances = new Map<string, Map<string, number>>();
  for (const account of person.accounts) {
    const own = files.filter((f) => f.account === account.id);
    const seen = new Set<string>();
    const parsed = own.flatMap((f) => {
      const result = readCsvFile({ name: f.name, text: f.text });
      const read = result.ok
        ? result
        : result.reason === "unknown_format"
          ? readCsvFile({ name: f.name, text: f.text, mapping: guessedMapping(f.text) })
          : result;
      if (!read.ok) {
        failedFiles.push(f.name);
        return [];
      }
      const days = fileBalances.get(account.id) ?? new Map<string, number>();
      for (const b of read.balances ?? []) days.set(b.date, b.balanceCents);
      fileBalances.set(account.id, days);
      return read.transactions;
    });
    const unique = parsed.filter((t) => {
      if (seen.has(t.externalId)) return false;
      seen.add(t.externalId);
      return true;
    });
    const categorized = await categorizeTransactions(
      unique.map((t) => ({ ...t, accountRef: account.id })),
      emptyDb,
      { askClaude: false },
    );
    for (const t of categorized) {
      const k = `${account.id}|${t.date}|${t.amountCents}|${clean(t.description)}`;
      const truthId = (truthBy.get(k) ?? []).find((id) => !used.has(id)) ?? null;
      if (truthId) used.add(truthId);
      rows.push({
        id: truthId ?? `${person.id}-extra${(extra += 1)}`,
        truthId,
        pending: t.pending,
        accountId: account.id,
        plaidTransactionId: null,
        date: t.date,
        amountCents: t.amountCents,
        description: t.description,
        merchantName: t.merchantName,
        pfcPrimary: t.category?.primary ?? null,
        pfcDetailed: t.category?.detailed ?? null,
        categorySource: t.categorySource,
      });
    }
  }
  // The balance the person typed, else the statement's latest (keepFileBalances).
  const latestInFile = (id: string) => {
    const days = [...(fileBalances.get(id) ?? new Map<string, number>())].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return days.length > 0 ? days[days.length - 1][1] : null;
  };
  const accounts = person.accounts.map((a) => ({
    id: a.id,
    type: ACCOUNT_KINDS[a.kind].type,
    subtype: ACCOUNT_KINDS[a.kind].subtype,
    name: a.name,
    currentBalanceCents: a.typesBalance ? balanceOn(person, a, person.asOf) : latestInFile(a.id),
  }));
  // The net worth line's balances (rebuildUploadedBalances): the statements' own days, and month
  // ends worked back from today's balance where the statement gave none.
  const snapshots = accounts.flatMap((a) => {
    const file = [...(fileBalances.get(a.id) ?? new Map<string, number>())].map(
      ([date, balanceCents]) => ({ accountId: a.id, date, balanceCents }),
    );
    if (a.currentBalanceCents === null) return file;
    const fileDays = new Set(file.map((b) => b.date));
    const derived = derivedBalances(
      a.type,
      a.currentBalanceCents,
      rows.filter((r) => r.accountId === a.id),
      person.asOf,
    )
      .filter((b) => !fileDays.has(b.date))
      .map((b) => ({ ...b, accountId: a.id }));
    return [...file, ...derived];
  });
  const paid = new Set(cardPaymentOutflows(rows, accounts));
  for (const r of rows) {
    if (paid.has(r.id)) {
      r.pfcPrimary = "LOAN_PAYMENTS";
      r.pfcDetailed = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
      r.categorySource = "rule";
    }
  }
  const cutoff = monthsBefore(person.asOf, LOOKBACK_MONTHS);
  const input = withDirectory(
    {
      asOf: person.asOf,
      accounts,
      transactions: rows
        .filter((r) => !r.pending && r.date > cutoff && r.date <= person.asOf)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
      recurringStreams: [],
    },
    MERCHANT_SEED,
  );
  const fileLatest = Object.fromEntries(person.accounts.map((a) => [a.id, latestInFile(a.id)]));
  return {
    person,
    files,
    failedFiles,
    rows,
    input,
    findings: detect(input),
    snapshots,
    fileLatest,
  };
}

// The two ways /import's balance question goes (#872: "What do you owe on this card today?"):
// the person answers it for every account, or skips it for every one. Answered, net worth and
// idle cash must be the hand-worked figures. Skipped, every account whose files carry no balance
// must be named as not counted (never a silent $0 or a figure that leaves it out), and idle cash
// must not fire from the cash Jane can see when the truth has none.
export type BalancePaths = {
  typedRight: boolean;
  idleTypedRight: boolean;
  leftOut: number;
  silent: boolean;
  idleSkippedFalse: boolean;
};

export function balancePaths(up: Upload): BalancePaths {
  const { person } = up;
  const withBalances = (balanceOf: (a: CsvPerson["accounts"][number]) => number | null) =>
    up.input.accounts.map((a) => {
      const account = person.accounts.find((x) => x.id === a.id)!;
      return { ...a, currentBalanceCents: balanceOf(account) };
    });
  const worthOf = (accounts: typeof up.input.accounts) =>
    netWorth(accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })));
  const idleOf = (accounts: typeof up.input.accounts) =>
    detect({ ...up.input, accounts }).some((f) => f.type === "idle_cash");
  const idleTruth = person.truth.findings.some((f) => f.type === "idle_cash");

  const typed = withBalances((a) => balanceOn(person, a, person.asOf));
  const skipped = withBalances((a) => up.fileLatest[a.id] ?? null);
  const skippedWorth = worthOf(skipped);
  const leftOut = skipped.filter((a) => a.currentBalanceCents === null).length;
  const said = notCounting(skippedWorth.unbalanced);
  return {
    typedRight: worthOf(typed).netCents === netWorthOn(person, person.asOf),
    idleTypedRight: idleOf(typed) === idleTruth,
    leftOut,
    silent: leftOut > 0 && (said === null || skippedWorth.unbalanced.length !== leftOut),
    idleSkippedFalse: idleOf(skipped) && !idleTruth,
  };
}

// --- Suggestions' confidence ------------------------------------------------------------------

// The profile the suggestions are made from, as an uploaded person's would be: the upload's rows
// and categories, and a balance only where one was typed or read from the statement.
export function profileInputOfUpload(up: Upload): ProfileInput {
  return {
    today: up.person.asOf,
    transactions: up.input.transactions.map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      pfc: t.pfcDetailed,
      accountId: t.accountId,
    })),
    accounts: up.input.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      balanceCents: a.currentBalanceCents ?? 0,
      ...(a.currentBalanceCents === null ? { balanceKnown: false } : {}),
    })),
    liabilities: [],
    told: {},
  };
}

// Whether a suggestion's topic is true of the person, for the topics the truth can answer (the
// sample bench's list, src/accuracy/score.ts).
const has = (p: CsvPerson, type: TrueFinding["type"]) =>
  p.truth.findings.some((f) => f.type === type);
const TOPIC_TRUTH: Record<string, (p: CsvPerson) => boolean> = {
  subscriptions: (p) => has(p, "subscription_review"),
  price_increase: (p) => has(p, "price_increase"),
  bank_fees: (p) => has(p, "bank_fees"),
  duplicate_charge: (p) => has(p, "duplicate_charge"),
  card_interest: (p) => has(p, "card_interest"),
  idle_cash: (p) => has(p, "idle_cash"),
  emergency_fund: (p) => !has(p, "idle_cash"),
};

// Every suggestion Jane would show this person on a topic the truth can judge, with its "% sure".
export function judgedOfUpload(up: Upload): Judged[] {
  const data = profileInputOfUpload(up);
  return runDetectors({ profile: buildProfile(data), data }).flatMap((s) => {
    const isTrue = TOPIC_TRUTH[s.topic];
    return isTrue
      ? [
          {
            person: up.person.id,
            topic: s.topic,
            percent: s.confidence.percent,
            right: isTrue(up.person),
          },
        ]
      : [];
  });
}

// --- Scores -----------------------------------------------------------------------------------

export type Tally = { tp: number; fp: number; fn: number };
const ratio = (num: number, den: number) => (den === 0 ? 1 : num / den);
export const precision = (t: Tally) => ratio(t.tp, t.tp + t.fp);
export const recall = (t: Tally) => ratio(t.tp, t.tp + t.fn);

export type Mistake = { person: string; what: string; kind: string; detail: string };

export type PersonScore = {
  person: string;
  files: number;
  filesExact: number;
  filesFailed: number;
  truthRows: number;
  rowsExact: number;
  rowsExtra: number;
  rowsMissing: number;
  categorized: number;
  categoryRight: number;
  categoryOf: number;
  findings: Record<TrueFinding["type"], Tally>;
  // "Coming up": bills due in the next 31 days, by their charges so far.
  bills: Tally;
  // Missed subscriptions found as recurring charges whose category can't say: on a live upload
  // Claude is asked about these (the bench runs without it).
  subscriptionsForClaude: number;
  dollars: { truth: number; jane: number; absError: number };
  falseDoubleCharges: number;
  spending: { truth: number; absError: number };
  income: { truth: number; absError: number };
  netWorth: { truth: number; jane: number };
  balancePaths: BalancePaths;
  line: { points: number; shown: number; absError: number; scale: number };
  // Whether Jane knew every account's balance today (typed, or from the statement).
  balancesKnown: boolean;
  // The suggestions it would show, with how sure each says it is and whether it's right.
  judged: Judged[];
  mistakes: Mistake[];
};

const primaryOf = (detailed: string) => categoryOf(detailed)?.primary ?? null;

// The rows a merchant finding is about: the stream with that key, else all of the merchant's.
function rowsOfKey(input: DetectionInput, key: string): string[] {
  const stream = buildStreams(input).find((s) => s.key === key);
  if (stream && stream.charges.length > 0) return stream.charges.map((c) => c.id);
  const merchant = key.replace(/^merchant:/, "").split("@")[0];
  return input.transactions.filter((t) => merchantOf(t)?.key === merchant).map((t) => t.id);
}

export async function scorePerson(person: CsvPerson): Promise<PersonScore> {
  const up = await runUpload(person);
  const mistakes: Mistake[] = [];
  const miss = (what: string, kind: string, detail: string) =>
    mistakes.push({ person: person.id, what, kind, detail });

  // Reading the files.
  const truthIds = new Set(person.rows.map((r) => r.id));
  const matched = new Set(up.rows.flatMap((r) => (r.truthId ? [r.truthId] : [])));
  const extras = up.rows.filter((r) => !r.truthId);
  for (const r of extras)
    miss("parse", "extra", `${r.accountId} ${r.date} ${r.amountCents} ${r.description}`);
  const missing = [...truthIds].filter((id) => !matched.has(id));
  for (const id of missing.slice(0, 5)) {
    const t = person.rows.find((x) => x.id === id)!;
    miss("parse", "missing", `${t.account} ${t.date} ${t.amountCents} ${t.descriptor} (${t.flow})`);
  }
  let filesExact = 0;
  for (const f of up.files) {
    if (up.failedFiles.includes(f.name)) {
      miss("parse", "file failed", f.name);
      continue;
    }
    const read = readCsvFile({ name: f.name, text: f.text });
    const n = read.ok
      ? read.transactions.length
      : ((
          readCsvFile({ name: f.name, text: f.text, mapping: guessedMapping(f.text) }) as {
            transactions?: unknown[];
          }
        ).transactions?.length ?? -1);
    if (n === f.rows.length && f.pending === 0) filesExact += 1;
  }

  // Categories, on the rows read right.
  let categoryRight = 0;
  let categorized = 0;
  const byTruth = new Map(person.rows.map((r) => [r.id, r]));
  const readRight = up.rows.filter((r) => r.truthId);
  for (const r of readRight) {
    const t = byTruth.get(r.truthId!)!;
    if (r.pfcDetailed) categorized += 1;
    const want = primaryOf(t.category);
    const got = r.pfcPrimary;
    if (got && (got === want || t.alsoOk?.includes(got as never))) categoryRight += 1;
    else
      miss(
        "category",
        got ? "wrong" : "none",
        `${r.description} → ${got ?? "nothing"}, is ${want}`,
      );
  }

  // Findings.
  const tallies = Object.fromEntries(
    FINDING_TYPES.map((t) => [t, { tp: 0, fp: 0, fn: 0 }]),
  ) as Record<TrueFinding["type"], Tally>;
  const dollars = { truth: 0, jane: 0, absError: 0 };
  const truthOf = (type: TrueFinding["type"]) =>
    person.truth.findings.filter((f) => f.type === type);
  const neutral = person.truth.neutral.flat();
  const claimed = new Set<TrueFinding>();
  for (const f of up.findings) {
    if (!FINDING_TYPES.includes(f.type as TrueFinding["type"])) continue;
    const type = f.type as TrueFinding["type"];
    let hit: TrueFinding | undefined;
    if (type === "bank_fees" || type === "card_interest") {
      const account = f.key.replace(/^account:/, "");
      hit = truthOf(type).find((t) => t.account === account);
    } else if (type === "idle_cash") {
      hit = truthOf(type)[0];
    } else if (type === "duplicate_charge") {
      const id = f.key.replace(/^transaction:/, "");
      hit = truthOf(type).find((t) => t.rows!.includes(id));
    } else {
      const ids = rowsOfKey(up.input, f.key);
      hit = truthOf(type).find((t) => !claimed.has(t) && t.rows!.some((id) => ids.includes(id)));
      if (!hit && type === "subscription_review" && ids.some((id) => neutral.includes(id)))
        continue;
    }
    if (hit && !claimed.has(hit)) {
      claimed.add(hit);
      tallies[type].tp += 1;
      if (hit.annualCents !== null && f.annualSavingsCents !== null) {
        dollars.truth += hit.annualCents;
        dollars.jane += f.annualSavingsCents;
        dollars.absError += Math.abs(f.annualSavingsCents - hit.annualCents);
        if (
          Math.abs(f.annualSavingsCents - hit.annualCents) > Math.max(100, hit.annualCents * 0.02)
        ) {
          miss(
            type,
            "dollars",
            `${f.title}: ${f.annualSavingsCents} vs ${hit.annualCents} (${hit.note})`,
          );
        }
      }
    } else if (!hit) {
      tallies[type].fp += 1;
      dollars.jane += f.annualSavingsCents ?? 0;
      miss(type, "false alarm", `${f.key} ${f.title}`);
    }
  }
  const ambiguous = buildStreams(up.input).filter(isAmbiguousRecurring);
  let subscriptionsForClaude = 0;
  for (const t of person.truth.findings) {
    if (claimed.has(t)) continue;
    if (
      t.type === "subscription_review" &&
      ambiguous.some((s) => s.charges.some((c) => t.rows!.includes(c.id)))
    ) {
      subscriptionsForClaude += 1;
    }
    tallies[t.type].fn += 1;
    if (t.annualCents !== null) dollars.truth += t.annualCents;
    miss(t.type, "missed", `${t.note} ${t.account ?? ""}`);
  }

  // "Coming up" in the next 31 days: the streams upcomingBills lists, by their charges.
  const bills = { tp: 0, fp: 0, fn: 0 };
  const until = addDays(person.asOf, 31);
  const coming = buildStreams(up.input).filter(
    (s) => s.active && isComingUp(s) && expectedDates(s, person.asOf, until).length > 0,
  );
  const neutralBills = person.truth.neutralBills.flat();
  const billed = new Set<number>();
  for (const s of coming) {
    const ids = s.charges.map((c) => c.id);
    const i = person.truth.bills.findIndex(
      (b, j) => !billed.has(j) && b.rows.some((id) => ids.includes(id)),
    );
    if (i >= 0) {
      billed.add(i);
      bills.tp += 1;
    } else if (
      !ids.some((id) => neutralBills.includes(id)) &&
      !person.truth.bills.some((b) => b.rows.some((id) => ids.includes(id)))
    ) {
      bills.fp += 1;
      miss("bills", "false alarm", `${s.merchant} ${s.lastAmountCents} ${s.frequency}`);
    }
  }
  person.truth.bills.forEach((b, i) => {
    if (billed.has(i)) return;
    bills.fn += 1;
    miss("bills", "missed", b.note);
  });

  // The spending chart's monthly totals, against the truth's.
  const months = monthEnds(person).map((d) => d.slice(0, 7));
  const either = new Set(person.rows.filter((r) => r.kind === "either").map((r) => r.id));
  const spending = { truth: 0, absError: 0 };
  const income = { truth: 0, absError: 0 };
  for (const month of months) {
    const truthIn = person.rows.filter((r) => r.date.startsWith(month));
    const janeIn = up.rows.filter(
      (r) => r.date.startsWith(month) && !(r.truthId && either.has(r.truthId)),
    );
    const tSpend = truthIn
      .filter((r) => r.kind === "spending")
      .reduce((s, r) => s + r.amountCents, 0);
    const tIncome = truthIn
      .filter((r) => r.kind === "income")
      .reduce((s, r) => s - r.amountCents, 0);
    let jSpend = 0;
    let jIncome = 0;
    for (const r of janeIn) {
      const kind = kindOf({ ...r, pending: r.pending });
      if (kind === "spending") jSpend += r.amountCents;
      if (kind === "income") jIncome -= r.amountCents;
    }
    spending.truth += tSpend;
    spending.absError += Math.abs(jSpend - tSpend);
    income.truth += tIncome;
    income.absError += Math.abs(jIncome - tIncome);
    if (Math.abs(jSpend - tSpend) > tSpend * 0.05)
      miss("spending", "month", `${month}: ${jSpend} vs ${tSpend}`);
    if (Math.abs(jIncome - tIncome) > Math.max(100, tIncome * 0.05))
      miss("income", "month", `${month}: ${jIncome} vs ${tIncome}`);
  }

  // Net worth today and its line: what the home hub draws for a person with only uploads.
  const todayCents = up.input.accounts.reduce(
    (s, a) => s + (a.type === "credit" ? -1 : 1) * (a.currentBalanceCents ?? 0),
    0,
  );
  const series = dailyNetWorth({
    accounts: up.input.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      currentBalanceCents: a.currentBalanceCents,
    })),
    snapshots: up.snapshots,
    owned: [],
    // The person's first day with Jane: the account made today, or its first balance if
    // earlier, as the home hub's line starts (src/lib/hub/net-worth-history.ts).
    firstDay: up.snapshots.reduce((first, s) => (s.date < first ? s.date : first), person.asOf),
    asOf: person.asOf,
    todayCents,
  });
  const truthNet = netWorthOn(person, person.asOf);
  if (todayCents !== truthNet) miss("net worth", "today", `${todayCents} vs ${truthNet}`);
  const line = { points: 0, shown: 0, absError: 0, scale: 0 };
  for (const d of monthEnds(person)) {
    const truth = netWorthOn(person, d);
    line.points += 1;
    line.scale += Math.abs(truth);
    const point = series.find((s) => s.date === d);
    if (!point) continue;
    line.shown += 1;
    line.absError += Math.abs(point.cents - truth);
  }

  return {
    person: person.id,
    files: up.files.length,
    filesExact,
    filesFailed: up.failedFiles.length,
    truthRows: truthIds.size,
    rowsExact: matched.size,
    rowsExtra: extras.length,
    rowsMissing: missing.length,
    categorized,
    categoryRight,
    categoryOf: readRight.length,
    findings: tallies,
    bills,
    subscriptionsForClaude,
    dollars,
    falseDoubleCharges: tallies.duplicate_charge.fp,
    spending,
    income,
    netWorth: { truth: truthNet, jane: todayCents },
    balancePaths: balancePaths(up),
    line,
    balancesKnown: up.input.accounts.every((a) => a.currentBalanceCents !== null),
    judged: judgedOfUpload(up),
    mistakes,
  };
}

export type CsvScoreboard = {
  people: number;
  files: number;
  parse: {
    filesExact: number;
    filesFailed: number;
    rowsExact: number;
    truthRows: number;
    extra: number;
    missing: number;
  };
  category: { right: number; of: number; uncategorized: number };
  findings: Record<TrueFinding["type"], Tally>;
  bills: Tally;
  subscriptionsForClaude: number;
  dollars: { truth: number; jane: number; absError: number };
  falseDoubleCharges: { count: number; people: number };
  spendingError: number;
  incomeError: number;
  netWorth: { right: number; absError: number };
  // /import's balance question, answered or skipped (balancePaths).
  balances: {
    typedRight: number;
    idleTypedRight: number;
    skippedPeople: number;
    leftOut: number;
    silent: number;
    idleSkippedFalse: number;
  };
  line: { coverage: number; error: number; errorWhereKnown: number; peopleKnown: number };
  // Is "80% sure" right 80% of the time, on uploaded statements?
  calibration: Bucket[];
  zeroPercent: number;
};

export function summarize(scores: readonly PersonScore[]): CsvScoreboard {
  const sum = (f: (s: PersonScore) => number) => scores.reduce((n, s) => n + f(s), 0);
  const findings = Object.fromEntries(
    FINDING_TYPES.map((t) => [
      t,
      {
        tp: sum((s) => s.findings[t].tp),
        fp: sum((s) => s.findings[t].fp),
        fn: sum((s) => s.findings[t].fn),
      },
    ]),
  ) as Record<TrueFinding["type"], Tally>;
  const lineShown = sum((s) => s.line.shown);
  return {
    people: scores.length,
    files: sum((s) => s.files),
    parse: {
      filesExact: sum((s) => s.filesExact),
      filesFailed: sum((s) => s.filesFailed),
      rowsExact: sum((s) => s.rowsExact),
      truthRows: sum((s) => s.truthRows),
      extra: sum((s) => s.rowsExtra),
      missing: sum((s) => s.rowsMissing),
    },
    category: {
      right: sum((s) => s.categoryRight),
      of: sum((s) => s.categoryOf),
      uncategorized: sum((s) => s.categoryOf - s.categorized),
    },
    findings,
    bills: { tp: sum((s) => s.bills.tp), fp: sum((s) => s.bills.fp), fn: sum((s) => s.bills.fn) },
    subscriptionsForClaude: sum((s) => s.subscriptionsForClaude),
    dollars: {
      truth: sum((s) => s.dollars.truth),
      jane: sum((s) => s.dollars.jane),
      absError: sum((s) => s.dollars.absError),
    },
    falseDoubleCharges: {
      count: sum((s) => s.falseDoubleCharges),
      people: scores.filter((s) => s.falseDoubleCharges > 0).length,
    },
    spendingError: ratio(
      sum((s) => s.spending.absError),
      sum((s) => s.spending.truth),
    ),
    incomeError: ratio(
      sum((s) => s.income.absError),
      sum((s) => s.income.truth),
    ),
    balances: {
      typedRight: scores.filter((s) => s.balancePaths.typedRight).length,
      idleTypedRight: scores.filter((s) => s.balancePaths.idleTypedRight).length,
      skippedPeople: scores.filter((s) => s.balancePaths.leftOut > 0).length,
      leftOut: sum((s) => s.balancePaths.leftOut),
      silent: scores.filter((s) => s.balancePaths.silent).length,
      idleSkippedFalse: scores.filter((s) => s.balancePaths.idleSkippedFalse).length,
    },
    netWorth: {
      right: scores.filter((s) => s.netWorth.jane === s.netWorth.truth).length,
      absError: sum((s) => Math.abs(s.netWorth.jane - s.netWorth.truth)),
    },
    calibration: calibration(scores.flatMap((s) => s.judged)),
    zeroPercent: scores.flatMap((s) => s.judged).filter((j) => j.percent <= 0).length,
    line: {
      errorWhereKnown:
        sum((s) => (s.balancesKnown ? s.line.absError : 0)) /
        Math.max(
          1,
          sum((s) => (s.balancesKnown ? s.line.scale : 0)),
        ),
      peopleKnown: scores.filter((s) => s.balancesKnown).length,
      coverage: ratio(
        lineShown,
        sum((s) => s.line.points),
      ),
      error:
        lineShown === 0
          ? 1
          : sum((s) => s.line.absError) /
            Math.max(
              1,
              sum((s) => s.line.scale),
            ),
    },
  };
}
