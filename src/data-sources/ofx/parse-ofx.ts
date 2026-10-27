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
  return match ? decode(match[1]) : null;
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
    }
  | { ok: false; file: string; error: string };

export function readOfx(file: { name: string; text: string }): OfxResult {
  if (!/<OFX>/i.test(file.text)) {
    return { ok: false, file: file.name, error: "This doesn't look like an OFX or QFX file." };
  }
  const transactions: Omit<NormalizedTransaction, "accountRef">[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();
  for (const match of file.text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const block = match[1];
    const line = file.text.slice(0, match.index).split("\n").length;
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
    if (seen.has(fitid)) continue;
    seen.add(fitid);
    const name = field(block, "NAME") ?? description;
    const type = field(block, "TRNTYPE");
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
  return { ok: true, file: file.name, transactions, skipped, balances: ledgerBalance(file.text) };
}

// <LEDGERBAL><BALAMT>…<DTASOF>…: the balance on that day. A card statement's is negative
// for what's owed (OFX's sign), so it's turned round.
function ledgerBalance(text: string): { date: string; balanceCents: number }[] {
  const block = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i.exec(
    text,
  )?.[1];
  if (!block) return [];
  const amount = ofxAmount(field(block, "BALAMT"));
  const date = ofxDate(field(block, "DTASOF"));
  if (amount === null || !date) return [];
  const card = /<CCSTMTRS>/i.test(text);
  return [{ date, balanceCents: card ? -amount || 0 : amount }];
}
