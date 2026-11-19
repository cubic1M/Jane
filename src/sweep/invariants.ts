import { isHiddenPage } from "@/config/hidden-pages";
import { landing } from "@/lib/area-pages/landing";
import type { Flat } from "./diff";

// The walkers' bug classes as rules over what a person sees (debug 3, 11-19; the classes and the
// PRs behind each are in the manager's notes, debug3-invariants.md). Each rule reads the flat
// snapshot `snapshotAt` takes (./snapshot.ts) and says what breaks it, path by path. Pure: the
// unit tests feed them the cases the walkers found; src/sweep/invariants.integration.test.ts runs
// them over every sweep person.

// The fields a person reads, by the last name in their path. Ids, keys, links, kinds, the
// profile's facts and a finding's evidence (the bank's own lines, which Jane matches on) aren't
// shown as written.
const SHOWN = new Set([
  "body",
  "caption",
  "detail",
  "empty",
  "figure",
  "headline",
  "healthWhy",
  "label",
  "line",
  "merchant",
  "note",
  "short",
  "sub",
  "title",
  "value",
  "why",
]);
const NOT_SHOWN = /(?:^profile\.|\.watch\.|\.evidence\.|\.action\.|\.refs\.)/;

// Every shown text in a snapshot, with its path. A tree's summaries are shown text whatever their
// item is called (trees.<area>.summaries.<item>).
export function shownTexts(flat: Flat): [path: string, text: string][] {
  return Object.entries(flat).flatMap(([path, value]): [string, string][] => {
    if (typeof value !== "string" || NOT_SHOWN.test(path)) return [];
    const last = path.slice(path.lastIndexOf(".") + 1);
    const summary = /^trees\.[^.]+\.summaries\./.test(path);
    return summary || SHOWN.has(last) ? [[path, value]] : [];
  });
}

// Class 1: a name shown is the cleaned name, never the bank's raw line. What gives a raw line
// away, each one a walker found on a card or a page: a store or terminal number ("Target
// 00012345"), a processor's prefix ("SQ *", "PAYPAL *", "AMZN Mktp"), an ACH entry's codes ("PPD
// ID: 1223344556", "DES:", "transaction#"), a bank's transfer wording ("Online Transfer To …
// Ref"), a customer-service number ("800-1234567"), or the line still in capitals ("VERIZON
// WIRELESS PAYMENTS").
const RAW_LINE: [what: string, pattern: RegExp][] = [
  ["a store or terminal number", /(?:#\d{2,}|(?<![$\d,.\-/])\b\d{5,}\b)/],
  ["a processor's prefix", /\b(?:SQ|Sq|TST|Tst|PAYPAL|Paypal|PayPal|AMZN|Amzn|SP|DD) ?\*|Mktp\b/],
  ["an ACH code", /\b(?:PPD|CCD|WEB|TEL) ID\b|\bDES:|\bID: ?\d|transaction#/i],
  ["a bank's transfer wording", /\bOnline Transfer (?:To|From)\b|\bRef ?#|\bConf# ?\d/],
  ["a customer-service number", /\b(?:1-)?8(?:00|33|44|55|66|77|88)-?\d{3}-?\d{4}\b/],
  ["a line in capitals", /\b[A-Z]{2,}(?:[ &/][A-Z]{2,}){2,}\b/],
];

export function rawLineMarks(text: string): string[] {
  return RAW_LINE.flatMap(([what, pattern]) => (pattern.test(text) ? [what] : []));
}

export function rawNames(flat: Flat): string[] {
  return shownTexts(flat).flatMap(([path, text]) =>
    rawLineMarks(text).map((what) => `${path}: ${what} in "${text.slice(0, 120)}"`),
  );
}

// Class 3: an area's counts add up, and its tile says what its page says. A tree's line ("1
// urgent · 6 to look at") is its items' statuses counted, each branch's line and status are its
// own items', and Home's tile takes the tree's status and line (src/lib/hub/area-status.ts).
// Walkers found a branch whose urgent item hid its things to look at (#2101), a tile saying
// "All good" over a page with items (#2113), a count that left one out (#1889).
const COUNT = (line: unknown, word: "urgent" | "to look at") => {
  const m = typeof line === "string" ? new RegExp(`(\\d+) (?:things? )?${word}`).exec(line) : null;
  return m ? Number(m[1]) : 0;
};
const RANK: Record<string, number> = { good: 0, look: 1, act: 2 };
const worstOf = (statuses: unknown[]) =>
  statuses.reduce<string | undefined>(
    (w, s) => (typeof s === "string" && (!w || RANK[s]! > RANK[w]!) ? s : w),
    undefined,
  );
// The names under `prefix.` in a flat snapshot (an array's items, by their names).
const childrenOf = (flat: Flat, prefix: string) => [
  ...new Set(
    Object.keys(flat)
      .filter((k) => k.startsWith(`${prefix}.`) && k !== `${prefix}.length`)
      .map((k) => k.slice(prefix.length + 1).split(".")[0]!),
  ),
];

export function areaCounts(flat: Flat): string[] {
  const found: string[] = [];
  const areas = Object.keys(flat).flatMap((k) => /^trees\.([^.]+)\.tree\.sub$/.exec(k)?.[1] ?? []);
  for (const area of areas) {
    const tree = `trees.${area}.tree`;
    let urgent = 0;
    let look = 0;
    const branchStatuses: unknown[] = [];
    for (const b of childrenOf(flat, `${tree}.branches`)) {
      const branch = `${tree}.branches.${b}`;
      const items = childrenOf(flat, `${branch}.items`).map(
        (i) => flat[`${branch}.items.${i}.status`],
      );
      const u = items.filter((s) => s === "act").length;
      const l = items.filter((s) => s === "look").length;
      urgent += u;
      look += l;
      const line = flat[`${branch}.line`];
      if ((u > 0 || l > 0) && (COUNT(line, "urgent") !== u || COUNT(line, "to look at") !== l)) {
        found.push(`${branch}.line: "${String(line)}", its items: ${u} urgent, ${l} to look at`);
      }
      const status = flat[`${branch}.status`];
      const own = worstOf(items);
      if (own && own !== "good" && status !== own) {
        found.push(`${branch}.status: ${String(status)}, its items' worst: ${own}`);
      }
      branchStatuses.push(status);
    }
    const sub = flat[`${tree}.sub`];
    const counted = urgent > 0 || look > 0;
    if (
      counted
        ? COUNT(sub, "urgent") !== urgent || COUNT(sub, "to look at") !== look
        : COUNT(sub, "urgent") + COUNT(sub, "to look at") > 0
    ) {
      found.push(`${tree}.sub: "${String(sub)}", its items: ${urgent} urgent, ${look} to look at`);
    }
    const health = flat[`tiles.${area}.health`];
    const status = worstOf(branchStatuses) ?? "good";
    if (health !== undefined && health !== null && health !== status) {
      found.push(
        `tiles.${area}.health: ${String(health)} ("${String(flat[`tiles.${area}.healthWhy`])}"), its page: ${status} ("${String(sub)}")`,
      );
    }
  }
  return found;
}

// Class 5: nothing is said about now from statements that ended long ago. When a person's
// statements end too long ago to say what's held or paid now (`statementsEnd`, the report's and
// Home's rule, staleStatementsEnd), a text that speaks of now also says when its figure is from.
// Walkers found "You keep $1,950.16 in cash" (#2095), "$12,511.09 today" (#1938), a month's
// payday and subscriptions said as current (#2047), "how much money do I have?" with no date
// (#2004).
const SAYS_NOW = [
  // Not a cover's monthly benefit ("you have $0/mo" of disability cover), which isn't cash.
  /\b[Yy]ou (?:keep|have|pay) \$[\d,.]+(?!k?\/mo)\b/,
  /\$[\d,]+(?:\.\d{2})? today\b/,
  /\bNothing (?:is )?(?:coming up|due)\b/,
];
const SAYS_WHEN =
  /\b(?:statements?|which) end\b|\bas of\b|\bon (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/;

export function nowFromOldData(flat: Flat, statementsEnd: string | null): string[] {
  if (!statementsEnd) return [];
  return shownTexts(flat).flatMap(([path, text]) =>
    SAYS_NOW.some((p) => p.test(text)) && !SAYS_WHEN.test(text)
      ? [`${path}: says now from statements that end ${statementsEnd}: "${text.slice(0, 120)}"`]
      : [],
  );
}

// Class 9: a link goes where it says, never to a page the beta hides (src/config/hidden-pages.ts:
// "nothing links to it"), wherever it's shown. A suggestion's button and the chat's links are
// drawn through landing() (src/lib/area-pages/landing.ts), which sends a hidden page to its area
// page; every other link is drawn as it is. Walkers found links to hidden pages on cards, trees
// and Home (#1886, #1894, #1909, #2060); debug 3 (11-19) found Home's strip linking every payday
// to /transfers and an open-enrollment deadline to /insurance/benefits. Rendered pages are
// crawled for the same (e2e/crawl.ts, "hidden-link").
const DRAWN_THROUGH_LANDING = /^(?:suggestions|chat)\./;

export function hiddenPageLinks(flat: Flat): string[] {
  return Object.entries(flat).flatMap(([path, href]) => {
    if (!path.endsWith(".href") || typeof href !== "string") return [];
    const drawn = DRAWN_THROUGH_LANDING.test(path) ? landing(href) : href;
    return isHiddenPage(drawn) ? [`${path}: goes to ${drawn}, a page the beta hides`] : [];
  });
}

// Class 6: no "nothing" claim when the history is too short to know. With less history than bills
// show in (CASH_FLOW_MIN_HISTORY_DAYS, the strip's own rule), a text that says nothing is due, or
// that it sees no bills or pay, also says the history is short. Walkers found "Nothing due in the
// next month" over one statement, rent and all (#2007), safe to spend with "no bills" from a
// month's data (#2064), "All good" over two weeks (#2107).
const SAYS_NONE = [
  /\bNothing (?:is )?(?:coming up|due)\b/,
  /\b(?:don't|didn't) see any (?:bills|income|pay|subscriptions)\b/,
  /\bNo (?:bills|income|subscriptions|paydays?)\b(?! to)/,
];
const SAYS_SHORT =
  /\b(?:[Tt]oo little|short|little) history\b|\bonly (?:\d+|a few|one) (?:days?|weeks?|months?|statements?)\b|\bonce (?:about )?(?:two|2) months\b|\bonly (?:one|a) (?:month|statement)\b/;

export function noneFromShortHistory(flat: Flat, short: boolean): string[] {
  if (!short) return [];
  return shownTexts(flat).flatMap(([path, text]) =>
    SAYS_NONE.some((p) => p.test(text)) && !SAYS_SHORT.test(text)
      ? [`${path}: says none from too little history: "${text.slice(0, 140)}"`]
      : [],
  );
}

// Class 2: a count agrees with its noun: "1 month", never "1 months"; "1 late fee". Walkers found
// "1 months of data" (#2019), "1 late fees" (#2064), "1 urgent · 1 things" (#2093). Not a lone 1
// that's part of a figure ("$1", "1.5", "11") or a date ("Nov 1"), and not words that end in s as
// one ("1 bonus").
const ONE_PLURAL =
  /(?<![\d.,$/-]|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* )\b1 ((?:late |new |more |open |unpaid |missed |full )?[a-z]+s(?<!ss|us|is))\b/;

export function onePlurals(flat: Flat): string[] {
  return shownTexts(flat).flatMap(([path, text]) => {
    const m = ONE_PLURAL.exec(text);
    return m ? [`${path}: "1 ${m[1]}" in "${text.slice(0, 120)}"`] : [];
  });
}

// Class 8: only what's owed is added up as owed. Home's loans tile ("$23k", "Owed on 4 accounts")
// is the debts on the Loans page added up, each at most a rounding apart, and counts the accounts
// with a balance (of all of them, "5 of 6", when one isn't known); the chat's "N are coming up,
// $X in all" adds up the rows it lists, never a return window's purchase. Walkers found a return
// window counted as owed (#2043), a liability with no limit read as $0 (#2018), fees counted as
// yearly bills (#1965), a payment that never pays off said as a total (#1942).
const DOLLARS = (text: unknown) => {
  const m = typeof text === "string" ? /\$([\d,]+(?:\.\d+)?)(k|m)?\b/.exec(text) : null;
  if (!m) return null;
  return Number(m[1]!.replace(/,/g, "")) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
};
// A shown figure's rounding: "$4.7k" is within $50, "$13k" within $500, "$312k" within $500.
const SLACK = (text: unknown) => {
  const m = typeof text === "string" ? /\$[\d,]+(\.\d+)?(k|m)?/.exec(text) : null;
  if (!m?.[2]) return 0.5;
  const unit = m[2] === "k" ? 1e3 : 1e6;
  return (m[1] ? unit / 10 ** (m[1].length - 1) : unit) / 2;
};

export function owedTotals(flat: Flat): string[] {
  const found: string[] = [];
  const debts = `trees.loans.tree.branches.debts.items`;
  // Each debt (an account or a pay-later plan) says its kind on its line; a row like "Installments
  // coming" doesn't.
  const accounts = childrenOf(flat, debts).filter(
    (i) => typeof flat[`${debts}.${i}.line`] === "string",
  );
  const owed = accounts.map((i) => flat[`${debts}.${i}.figure`]).filter((f) => DOLLARS(f) !== null);
  const value = flat["tiles.loans.value"];
  if (typeof value === "string" && DOLLARS(value) !== null) {
    const sum = owed.reduce<number>((a, f) => a + DOLLARS(f)!, 0);
    const slack = SLACK(value) + owed.reduce<number>((a, f) => a + SLACK(f), 0);
    if (Math.abs(sum - DOLLARS(value)!) > slack) {
      found.push(`tiles.loans.value: ${value}, the Loans page's debts add up to $${sum}`);
    }
  }
  const caption = flat["tiles.loans.caption"];
  const counted =
    typeof caption === "string" ? /^Owed on (\d+)(?: of (\d+))? accounts?$/.exec(caption) : null;
  if (counted) {
    const [n, of] = [Number(counted[1]), counted[2] ? Number(counted[2]) : owed.length];
    if (n !== owed.length || of !== accounts.length) {
      found.push(
        `tiles.loans.caption: "${caption}", the Loans page: ${owed.length} with a balance of ${accounts.length}`,
      );
    }
  }
  const chat = flat["chat.what bills are coming up.body"];
  const total = typeof chat === "string" ? /, (\$[\d,]+\.\d{2}) in all\./.exec(chat) : null;
  if (total) {
    const rows = childrenOf(flat, "home.summary.comingUp").map((r) => `home.summary.comingUp.${r}`);
    const sum = rows
      .filter((r) => flat[`${r}.kind`] !== "return")
      .reduce(
        (a, r) =>
          a +
          (typeof flat[`${r}.amountCents`] === "number" ? (flat[`${r}.amountCents`] as number) : 0),
        0,
      );
    if (Math.round(DOLLARS(total[1])! * 100) !== sum) {
      found.push(
        `chat.what bills are coming up.body: ${total[1]} in all, what's owed in its rows: $${(sum / 100).toFixed(2)}`,
      );
    }
  }
  return found;
}
