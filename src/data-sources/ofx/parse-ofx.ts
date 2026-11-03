import { boundedText } from "@/data-sources/csv/parse-csv";
import { CONTROL_MIN_SIGN_VOTES, CONTROL_SIGN_REVERSED_SHARE } from "@/config/import";
import { controlTotals, type ControlReport } from "@/data-sources/csv/control-totals";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { NormalizedTransaction, SkippedRow } from "@/data-sources/types";
import { parseMoneyToCents } from "@/lib/money";

// OFX and QFX (Quicken's OFX) statements: what most banks offer for download besides CSV.
// One reader handles both dialects: OFX 1.x is SGML, where single values aren't closed
// (<TRNAMT>-15.49), and OFX 2.x is XML (<TRNAMT>-15.49</TRNAMT>). Every transaction has
// the bank's own id (FITID), which becomes its dedupe key, so re-importing a file adds
// nothing. Read in memory only; the file itself is never stored.

export function looksLikeOfx(name: string, text: string): boolean {
  return /\.(ofx|qfx)$/i.test(name) || /^\s*(OFXHEADER:|<\?xml[^>]*>\s*<\?OFX)/i.test(text);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value: string) =>
  value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]).trim();

// A single value inside one aggregate: up to the next tag or line end, closed or not.
function field(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return match ? decode(boundedText(match[1])) : null;
}

// "20261001120000[-5:EST]" or "20261002000000.000" -> "2026-10-01". The bank's local
// date is the posting date, as with CSV.
function ofxDate(value: string | null): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const [, y, m, d] = match;
  const date = `${y}-${m}-${d}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

// Some banks write a decimal comma ("-15,49").
function ofxAmount(value: string | null): number | null {
  if (!value) return null;
  const text = value.includes(".") ? value : value.replace(",", ".");
  return parseMoneyToCents(text);
}

export type OfxResult =
  | {
      ok: true;
      file: string;
      transactions: Omit<NormalizedTransaction, "accountRef">[];
      skipped: SkippedRow[];
      // The statement's closing balance (<LEDGERBAL>), as Jane keeps balances: what a card
      // owes is positive. Empty when the file has none.
      balances: { date: string; balanceCents: number }[];
      // Whether the file adds up (src/data-sources/csv/control-totals.ts).
      control: ControlReport;
    }
  | { ok: false; file: string; error: string };

// Each <STMTTRN>…</STMTTRN> and the line it starts on, in one pass over the file. A lazy pattern looked
// for a closing tag from every opening one: 200 KB of unclosed tags took 2 seconds, and 4 MB 400 times
// that. With no closing tag left, there's nothing more to find.
function* transactionBlocks(text: string): Generator<{ block: string; line: number }> {
  const open = /<STMTTRN>/gi;
  const close = /<\/STMTTRN>/gi;
  let line = 1;
  let counted = 0;
  for (let start = open.exec(text); start; start = open.exec(text)) {
    close.lastIndex = open.lastIndex;
    const end = close.exec(text);
    if (!end) return;
    for (let at = text.indexOf("\n", counted); at !== -1 && at < start.index;) {
      line += 1;
      at = text.indexOf("\n", at + 1);
    }
    counted = start.index;
    yield { block: text.slice(open.lastIndex, end.index), line };
    open.lastIndex = close.lastIndex;
  }
}

export function readOfx(file: { name: string; text: string }): OfxResult {
  if (!/<OFX>/i.test(file.text)) {
    return { ok: false, file: file.name, error: "This doesn't look like an OFX or QFX file." };
  }
  const transactions: Omit<NormalizedTransaction, "accountRef">[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Map<string, number>();
  let sameId = 0;
  let doubled = 0;
  let againstType = 0;
  let typed = 0;
  let blocks = 0;
  for (const { block, line } of transactionBlocks(file.text)) {
    blocks += 1;
    const date = ofxDate(field(block, "DTPOSTED"));
    const amount = ofxAmount(field(block, "TRNAMT"));
    const fitid = field(block, "FITID");
    const description = [field(block, "NAME"), field(block, "MEMO")]
      .filter((v): v is string => Boolean(v))
      .join(" ")
      .trim();
    const reason = !date
      ? "Missing or unreadable date (DTPOSTED)"
      : amount === null
        ? "Missing or unreadable amount (TRNAMT)"
        : !fitid
          ? "Missing the bank's transaction id (FITID)"
          : null;
    if (reason || !date || amount === null || !fitid) {
      skipped.push({ file: file.name, line, reason: reason ?? "Unreadable transaction" });
      continue;
    }
    if (seen.has(fitid)) {
      // The bank's own id twice: the same row again, unless the amount differs.
      doubled += 1;
      if (seen.get(fitid) !== amount) sameId += 1;
      continue;
    }
    seen.set(fitid, amount);
    const name = field(block, "NAME") ?? description;
    const type = field(block, "TRNTYPE");
    // OFX signs money out as negative, and a DEBIT or CREDIT says the same thing in words.
    if (amount !== 0 && /^(?:DEBIT|CREDIT)$/i.test(type ?? "")) {
      typed += 1;
      if (/^DEBIT$/i.test(type ?? "") !== amount < 0) againstType += 1;
    }
    transactions.push({
      date,
      // OFX signs money out as negative; we follow Plaid, where money out is positive.
      amountCents: -amount || 0,
      description: description || "Transaction",
      merchantName: normalizeMerchant(name)?.name ?? null,
      categoryPrimary: null,
      categoryDetailed: null,
      pending: false,
      externalId: `ofx:${fitid}`,
      hints: type ? { bankType: type } : {},
    });
  }
  if (transactions.length === 0 && skipped.length === 0) {
    return { ok: false, file: file.name, error: "The file has no transactions." };
  }
  const control = controlTotals({
    rows: [],
    described: transactions,
    stated: {},
    counts: {
      inFile: blocks,
      read: transactions.length,
      skipped: skipped.length,
      leftOut: doubled,
    },
    unread: skipped.length,
    repeatedHeaders: 0,
    kind: /<CCSTMTRS>/i.test(file.text) ? "credit_card" : null,
  });
  const opened = (file.text.match(/<STMTTRN>/gi) ?? []).length;
  if (opened > blocks || !/<\/OFX>/i.test(file.text)) {
    control.warnings.push({
      code: "cut_off",
      message:
        "This file stops before its end, as if the download was cut off, so some rows may be missing.",
    });
  }
  if (sameId > 0) {
    control.warnings.push({
      code: "same_id",
      message: `${sameId === 1 ? "A row has" : `${sameId} rows have`} the bank's id of another row with a different amount, so only the first was kept. Totals from this file can be off.`,
    });
  }
  if (
    typed >= CONTROL_MIN_SIGN_VOTES &&
    againstType / typed >= CONTROL_SIGN_REVERSED_SHARE &&
    !control.warnings.some((w) => w.code === "signs_reversed")
  ) {
    control.warnings.push({
      code: "signs_reversed",
      message:
        "The amounts run against the file's own debit and credit labels. Check them before relying on totals from this file.",
    });
  }
  return {
    ok: true,
    file: file.name,
    transactions,
    skipped,
    balances: ledgerBalance(file.text),
    control,
  };
}

// <LEDGERBAL><BALAMT>…<DTASOF>…: the balance on that day. A card statement's is negative
// for what's owed (OFX's sign), so it's turned round.
function ledgerBalance(text: string): { date: string; balanceCents: number }[] {
  // Two steps, not a lazy pattern, for the same reason as transactionBlocks.
  const open = /<LEDGERBAL>/i.exec(text);
  if (!open) return [];
  const rest = text.slice(open.index + open[0].length);
  const end = rest.search(/<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>/i);
  const block = end === -1 ? "" : rest.slice(0, end);
  if (!block) return [];
  const amount = ofxAmount(field(block, "BALAMT"));
  const date = ofxDate(field(block, "DTASOF"));
  if (amount === null || !date) return [];
  const card = /<CCSTMTRS>/i.test(text);
  return [{ date, balanceCents: card ? -amount || 0 : amount }];
}
