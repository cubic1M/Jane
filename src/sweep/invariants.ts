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
