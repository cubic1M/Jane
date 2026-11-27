import { RETENTION, RETENTION_REMIND_DAYS } from "@/config/records";
import { ITEMIZED } from "@/config/tax-rates";
import { addDays } from "@/lib/dates";
import { centsToInput } from "@/lib/money";

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
  // What the estimate counts, and nothing else.
  claimedCents: number;
  // All that was paid, where only a part of it can count: its own figure, with its own label.
  gross?: { label: string; cents: number };
  evidence: Evidence[];
  // What's still needed to back it up (e.g. a charity's receipt for a big gift).
  needs: string[];
};

// Medical costs count only above a share of income, and only when itemizing beats the standard
// deduction.
export function medicalFigures(
  paidCents: number,
  deduction: { kind: "standard" | "itemized"; itemized: { medicalCents: number } },
): Required<Pick<AuditItem, "claimedCents" | "gross">> {
  const claimedCents = deduction.kind === "itemized" ? deduction.itemized.medicalCents : 0;
  const floor = `${ITEMIZED.medicalFloorShare * 100}%`;
  const label =
    deduction.kind === "standard"
      ? "All medical costs paid (the estimate takes the standard deduction, so none is claimed)"
      : claimedCents > 0
        ? `All medical costs paid, before the ${floor} of income floor`
        : `All medical costs paid, none over ${floor} of income`;
  return { claimedCents, gross: { label, cents: paidCents } };
}

// Gifts, mortgage interest and property tax count only when the estimate itemizes (cash gifts also
// count a little under the standard deduction: the estimate's own figure). "Claimed" is what the
// estimate counts, nothing else: under the standard deduction these lines show what was paid under
// their own label and say that the standard deduction is larger.
export type ItemizedLine = "gifts" | "mortgage_interest" | "property_tax";
const LINE_NOUN: Record<ItemizedLine, string> = {
  gifts: "gifts",
  mortgage_interest: "mortgage interest",
  property_tax: "property tax",
};

export function itemizedLineFigures(
  line: ItemizedLine,
  paidCents: number,
  deduction: {
    kind: "standard" | "itemized";
    nonItemizerCharityCents: number;
    itemized: { charityCents: number; mortgageInterestCents: number };
  },
): Pick<AuditItem, "claimedCents" | "gross"> {
  const noun = LINE_NOUN[line];
  if (deduction.kind === "standard") {
    const claimedCents = line === "gifts" ? deduction.nonItemizerCharityCents : 0;
    const said =
      claimedCents > 0
        ? "the standard deduction is larger, so only the cash gifts it allows are claimed"
        : "the standard deduction is larger, so none is claimed";
    return {
      claimedCents,
      gross: { label: `All ${noun} paid (${said})`, cents: paidCents },
    };
  }
  // Itemizing: the estimate's own figure where it has one; property tax is counted inside its
  // state and local tax line, so what was paid stands.
  const claimedCents =
    line === "gifts"
      ? deduction.itemized.charityCents
      : line === "mortgage_interest"
        ? deduction.itemized.mortgageInterestCents
        : paidCents;
  return claimedCents === paidCents
    ? { claimedCents }
    : {
        claimedCents,
        gross: { label: `All ${noun} paid, more than the estimate counts`, cents: paidCents },
      };
}

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
  const counted = candidates.filter((c) => c.claimedCents > 0 || (c.gross?.cents ?? 0) > 0);
  const withSource = counted.filter((c) => c.evidence.length > 0);
  return {
    year,
    items: withSource,
    gaps: counted
      .filter((c) => c.evidence.length === 0)
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

// Which receipt stands for each charge. One receipt stands for one charge: where more charges
// than receipts could claim the same ones, none of them is called receipted.
export function matchReceipts(
  charges: { id: string; date: string; cents: number }[],
  receipts: Parameters<typeof matchReceipt>[1],
  days: number,
): Map<string, { id: string; fileName: string }> {
  // Earliest charge first, each taking its earliest free receipt: with one window length that gives
  // as many charges a receipt as can have one, whatever order they arrived in.
  const byDate = (a: { date: string | null }, b: { date: string | null }) =>
    (a.date ?? "").localeCompare(b.date ?? "");
  const dated = [...receipts].sort(byDate);
  const options = new Map(
    [...charges]
      .sort(byDate)
      .map((c) => [c.id, dated.filter((r) => matchReceipt(c, [r], days) !== null)]),
  );
  const heldBy = new Map<string, string>();
  const matched = new Map<string, { id: string; fileName: string }>();
  for (const [id, found] of options) {
    const receipt = found.find((r) => !heldBy.has(r.id));
    if (!receipt) continue;
    heldBy.set(receipt.id, id);
    matched.set(id, { id: receipt.id, fileName: receipt.fileName });
  }
  // A charge left without one competes with whoever holds a receipt it could claim, and they with
  // whoever holds theirs: more charges than receipts, so none of that group is called receipted.
  // (A set also walks what is added to it on the way.)
  const short = new Set([...options.keys()].filter((id) => !matched.has(id)));
  for (const id of short) {
    for (const receipt of options.get(id)!) {
      const holder = heldBy.get(receipt.id);
      if (holder) short.add(holder);
    }
  }
  for (const id of short) matched.delete(id);
  return matched;
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

// Text cells that a spreadsheet could read as a formula get an apostrophe; an amount cell (digits, a
// point and a minus) doesn't, or a negative amount turns into text that SUM skips.
const csvCell = (value: string, isAmount = false): string => {
  const safe = !isAmount && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

const evidenceText = (e: Evidence): [string, string, string, string] => {
  switch (e.kind) {
    case "transaction":
      return ["Transaction", e.date, e.payee, centsToInput(e.cents)];
    case "receipt":
      return ["Receipt", "", e.fileName, ""];
    case "form":
      return ["Form", "", `${e.form} from ${e.from}`, centsToInput(e.cents)];
    case "loan":
      return ["Lender", "", e.name, centsToInput(e.cents)];
    case "answer":
      return ["Your answer", "", e.label, ""];
  }
};

// The audit pack as a CSV: each item with its claimed amount, then every source under it,
// then what's still needed and the items counted without a source.
export function auditPackCsv(pack: AuditPack): string {
  const rows: string[][] = [["Item", "Source", "Date", "Detail", "Amount"]];
  for (const item of pack.items) {
    rows.push([item.label, "Claimed", "", "", centsToInput(item.claimedCents)]);
    if (item.gross) {
      rows.push([item.label, item.gross.label, "", "", centsToInput(item.gross.cents)]);
    }
    for (const e of item.evidence) rows.push([item.label, ...evidenceText(e)]);
    for (const n of item.needs) rows.push([item.label, "Still needed", "", n, ""]);
  }
  for (const item of pack.gaps) {
    rows.push([
      item.label,
      "No source yet",
      "",
      item.needs.join(" "),
      centsToInput(item.claimedCents),
    ]);
  }
  return `${rows.map((r) => r.map((cell, i) => csvCell(cell, i === 4)).join(",")).join("\r\n")}\r\n`;
}
