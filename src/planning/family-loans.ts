import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import {
  LOAN_WORDS,
  NOT_LOAN_WORDS,
  PAYMENT_APPS,
  CANDIDATE_MIN_CENTS,
  REGULAR_AMOUNT_SHARE,
  REGULAR_PAYMENT_MONTHS,
} from "@/config/family-loans";

// Money between family and friends (spec step 226). Pure: a payment-app transfer read for who
// it was with and its note, whether it might be a loan, a loan's balance after repayments,
// and a kind reminder for the person to send themselves.

export type Transfer = {
  id: string;
  date: string;
  // Plaid's sign: positive is money out.
  amountCents: number;
  description: string;
  merchantName: string | null;
};

export type ParsedTransfer = {
  app: string;
  counterparty: string;
  note: string | null;
  // out: the person sent it; in: they received it.
  direction: "out" | "in";
};

const APP_RE = new RegExp(
  `\\b(${PAYMENT_APPS.map((a) => a.replace(" ", "\\s?")).join("|")})\\b`,
  "i",
);

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/[#*]\S*\d\S*/g, "")
    .trim();

export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// "VENMO PAYMENT TO JORDAN LEE - rent loan" or "ZELLE FROM SAM RIVERA: paying you back".
export function parseTransfer(
  t: Pick<Transfer, "amountCents" | "description">,
): ParsedTransfer | null {
  const text = clean(t.description);
  const app = APP_RE.exec(text);
  if (!app) return null;
  const rest = text.slice(app.index + app[0].length);
  const m =
    /\b(to|from)\s+([A-Za-z][A-Za-z.'-]*(?:\s[A-Za-z][A-Za-z.'-]*){0,2}?)(?:\s*[-:|]\s*(.+))?$/i.exec(
      rest,
    );
  if (!m) return null;
  const counterparty = titleCase(m[2].trim());
  if (!counterparty || nameKey(counterparty).length < 2) return null;
  return {
    app: titleCase(app[1]),
    counterparty,
    note: m[3]?.trim() || null,
    direction: m[1].toLowerCase() === "to" ? "out" : "in",
  };
}

export type Candidate = {
  id: string;
  transfer: Transfer;
  parsed: ParsedTransfer;
  // The loan it would be: the person lent it (out) or borrowed it (in).
  kind: "lent" | "borrowed";
  hint: string;
};

const has = (text: string, words: readonly string[]) => words.some((w) => text.includes(w));

// Transfers of about the same amount with the same person, the same way, in enough different
// months to be a regular payment (debugger 11-14: a student's "ZELLE TO ROOMMATE RENT", $650 on
// the 3rd of every month, was asked about as money lent).
function regularIds(transfers: readonly Transfer[]): Set<string> {
  const byPerson = new Map<string, { id: string; month: string; cents: number }[]>();
  for (const t of transfers) {
    const parsed = parseTransfer(t);
    if (!parsed) continue;
    const key = `${parsed.direction}:${nameKey(parsed.counterparty)}`;
    const list = byPerson.get(key) ?? [];
    list.push({ id: t.id, month: t.date.slice(0, 7), cents: Math.abs(t.amountCents) });
    byPerson.set(key, list);
  }
  const out = new Set<string>();
  for (const list of byPerson.values()) {
    for (const a of list) {
      const months = new Set(
        list
          .filter((b) => Math.abs(b.cents - a.cents) <= a.cents * REGULAR_AMOUNT_SHARE)
          .map((b) => b.month),
      );
      if (months.size >= REGULAR_PAYMENT_MONTHS) out.add(a.id);
    }
  }
  return out;
}

// Transfers that might be a loan: with a name, big enough or noted like one, not noted like
// a split bill, not a regular payment. A transfer back from someone the person lent to is a
// repayment, not a loan.
export function candidatesFrom(
  transfers: readonly Transfer[],
  known: readonly { counterpartyKey: string; kind: string }[],
): Candidate[] {
  const out: Candidate[] = [];
  const regular = regularIds(transfers);
  for (const t of transfers) {
    if (regular.has(t.id)) continue;
    const parsed = parseTransfer(t);
    if (!parsed) continue;
    const key = nameKey(parsed.counterparty);
    const kind = parsed.direction === "out" ? "lent" : "borrowed";
    // Money back from someone owed, or out to someone who lent: a repayment.
    const repayment = known.some(
      (k) =>
        k.counterpartyKey === key &&
        ((kind === "borrowed" && k.kind === "lent") || (kind === "lent" && k.kind === "borrowed")),
    );
    if (repayment) continue;
    const note = (parsed.note ?? "").toLowerCase();
    if (note && has(note, NOT_LOAN_WORDS)) continue;
    const noted = note && has(note, LOAN_WORDS);
    if (Math.abs(t.amountCents) < CANDIDATE_MIN_CENTS && !noted) continue;
    out.push({
      id: `tx:${t.id}`,
      transfer: t,
      parsed,
      kind,
      hint: parsed.note ? `with the note "${parsed.note}"` : "with no note",
    });
  }
  return out.sort((a, b) => b.transfer.date.localeCompare(a.transfer.date));
}

// What's left on a loan: the first transfer less the transfers the other way with the same
// person since. Never below zero.
export function loanBalance(
  loan: {
    kind: "lent" | "borrowed";
    counterpartyKey: string;
    principalCents: number;
    openedOn: string;
  },
  transfers: readonly Transfer[],
): { balanceCents: number; repaid: { date: string; cents: number }[] } {
  const repaid: { date: string; cents: number }[] = [];
  for (const t of transfers) {
    if (t.date <= loan.openedOn) continue;
    const parsed = parseTransfer(t);
    if (!parsed || nameKey(parsed.counterparty) !== loan.counterpartyKey) continue;
    // Lent: money in from them pays it back. Borrowed: money out to them does.
    const back = loan.kind === "lent" ? parsed.direction === "in" : parsed.direction === "out";
    if (back) repaid.push({ date: t.date, cents: Math.abs(t.amountCents) });
  }
  const total = repaid.reduce((s, r) => s + r.cents, 0);
  return { balanceCents: Math.max(0, loan.principalCents - total), repaid };
}

// A kind reminder for the person to send themselves. Jane never sends it.
export function reminderText(input: {
  counterparty: string;
  balanceCents: number;
  principalCents: number;
  openedOn: string;
  app: string | null;
}): string {
  const first = input.counterparty.split(" ")[0];
  const partly =
    input.balanceCents < input.principalCents
      ? ` Thank you for what you've already sent back; ${formatCents(input.balanceCents)} is left.`
      : "";
  return `Hi ${first}, hope you're well! A gentle reminder about the ${formatCents(input.principalCents)} from ${dayLabel(input.openedOn)}.${partly} No rush, and let me know if a different schedule would help${input.app ? `. You can send it on ${input.app}` : ""}.`;
}
