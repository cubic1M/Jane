import { ITEM_RETENTION, RETENTION, RETENTION_REMIND_DAYS } from "@/config/records";

// Audit-ready records (spec step 171). Pure. Every deduction and credit Jane counts is an
// item with the transactions, receipts, forms and answers that support it. An item with no
// source isn't in the pack: it's listed as a gap with what's needed, so nothing in the pack
// lacks its source.

export type Evidence =
  | {
      kind: "transaction";
      id: string;
      date: string;
      payee: string;
      cents: number;
      receipt: boolean;
    }
  | { kind: "receipt"; id: string; fileName: string }
  | { kind: "form"; key: string; form: string; from: string; cents: number }
  | { kind: "loan"; name: string; cents: number }
  | { kind: "answer"; label: string };

export type AuditItem = {
  key: string;
  label: string;
  claimedCents: number;
  evidence: Evidence[];
  // What's still needed to back it up (e.g. a charity's receipt for a big gift).
  needs: string[];
};

export type AuditPack = {
  year: number;
  // Items with at least one source.
  items: AuditItem[];
  // Items counted without a source: not in the pack.
  gaps: AuditItem[];
  // Items in the pack that still need something.
  incomplete: AuditItem[];
};

export function buildAuditPack(year: number, candidates: AuditItem[]): AuditPack {
  const withSource = candidates.filter((c) => c.claimedCents > 0 && c.evidence.length > 0);
  return {
    year,
    items: withSource,
    gaps: candidates
      .filter((c) => c.claimedCents > 0 && c.evidence.length === 0)
      .map((c) => ({
        ...c,
        needs: c.needs.length > 0 ? c.needs : ["A document or receipt for it."],
      })),
    incomplete: withSource.filter((c) => c.needs.length > 0),
  };
}

// A receipt in the vault for a transaction: same amount, within the days.
export function matchReceipt(
  t: { date: string; cents: number },
  receipts: { id: string; fileName: string; date: string | null; cents: number | null }[],
  days: number,
): { id: string; fileName: string } | null {
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const found =
    receipts.find(
      (r) =>
        r.date !== null &&
        r.cents === t.cents &&
        Math.abs(ms(r.date) - ms(t.date)) <= days * 86_400_000,
    ) ?? null;
  return found ? { id: found.id, fileName: found.fileName } : null;
}

export type Retention = {
  year: number;
  key: keyof typeof RETENTION;
  label: string;
  rule: string;
  // The last day to keep records for this tax year: its filing deadline plus the years.
  keepUntil: string;
  remindOn: string;
  status: "keep" | "soon" | "can_go";
};

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// When a tax year's records can go: April 15 of the year after, plus the years.
export function retentionFor(year: number, key: keyof typeof RETENTION, today: string): Retention {
  const rule = RETENTION[key];
  const keepUntil = `${year + 1 + rule.years}-04-15`;
  const remindOn = addDays(keepUntil, -RETENTION_REMIND_DAYS);
  return {
    year,
    key,
    label: rule.label,
    rule: rule.rule,
    keepUntil,
    remindOn,
    status: today > keepUntil ? "can_go" : today >= remindOn ? "soon" : "keep",
  };
}

// The tax years with records, oldest first, each with how long to keep it (the return's
// records; property records are kept until its sale's return, not scheduled).
export function retentionSchedule(years: number[], today: string): Retention[] {
  return [...new Set(years)].sort().map((y) => retentionFor(y, "return", today));
}

export const retentionOfItem = (itemKey: string) => ITEM_RETENTION[itemKey] ?? "return";

const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
const dollars = (cents: number) => (cents / 100).toFixed(2);

const evidenceText = (e: Evidence): [string, string, string, string] => {
  switch (e.kind) {
    case "transaction":
      return ["Transaction", e.date, e.payee, dollars(e.cents)];
    case "receipt":
      return ["Receipt", "", e.fileName, ""];
    case "form":
      return ["Form", "", `${e.form} from ${e.from}`, dollars(e.cents)];
    case "loan":
      return ["Lender", "", e.name, dollars(e.cents)];
    case "answer":
      return ["Your answer", "", e.label, ""];
  }
};

// The audit pack as a CSV: each item with its claimed amount, then every source under it,
// then what's still needed and the items counted without a source.
export function auditPackCsv(pack: AuditPack): string {
  const rows: string[][] = [["Item", "Source", "Date", "Detail", "Amount"]];
  for (const item of pack.items) {
    rows.push([item.label, "Claimed", "", "", dollars(item.claimedCents)]);
    for (const e of item.evidence) rows.push([item.label, ...evidenceText(e)]);
    for (const n of item.needs) rows.push([item.label, "Still needed", "", n, ""]);
  }
  for (const item of pack.gaps) {
    rows.push([item.label, "No source yet", "", item.needs.join(" "), dollars(item.claimedCents)]);
  }
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
