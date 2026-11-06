import { BILLERS, type Biller } from "@/config/billers";
import {
  MANUAL_PAY_AUTOPAY_LOOKBACK_DAYS,
  MANUAL_PAY_BANK_BILL_PAY_LEAD_BUSINESS_DAYS,
  MANUAL_PAY_LEAD_BUSINESS_DAYS,
} from "@/config/connectors";

// The rules of "Jane prepares, you pay" (roadmap round 8), pure: which biller, which day to pay,
// whether autopay already covers it, and which bank line is the payment. Jane never moves the money
// and never types an account number: the person pays on the biller's page or their bank's bill pay,
// and Jane checks their transactions for it afterwards.

const DAY = 24 * 60 * 60 * 1000;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`);
const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

function addBusinessDays(isoDay: string, days: number): string {
  const d = dayOf(isoDay);
  const step = days < 0 ? -1 : 1;
  for (let left = Math.abs(days); left > 0;) {
    d.setUTCDate(d.getUTCDate() + step);
    if (isWeekday(d)) left -= 1;
  }
  return iso(d);
}

const words = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, " ")
    .trim();

// The biller a name refers to: the one whose first match token appears in it, longest first.
export function billerFor(name: string): Biller | null {
  const text = ` ${words(name)} `;
  let best: { biller: Biller; length: number } | null = null;
  for (const biller of BILLERS) {
    const token = words(biller.matchTokens[0] ?? "");
    if (token && text.includes(` ${token} `) && (!best || token.length > best.length)) {
      best = { biller, length: token.length };
    }
  }
  return best?.biller ?? null;
}

// Words a bank's legal name carries that say nothing about which bank it is.
const BANK_FILLER = new Set([
  "THE",
  "BANK",
  "NATIONAL",
  "ASSOCIATION",
  "N",
  "A",
  "NA",
  "FSB",
  "INC",
]);

// What a bank line must say for a deposit to be this bank's pull: its name without the filler,
// up to "by" ("Marcus by Goldman Sachs" is MARCUS). "The Bancorp Bank" is BANCORP, never THE (a
// Home Depot line), and "American Express National Bank" is AMERICAN EXPRESS, never AMERICAN
// (an airline). Empty when nothing is left.
export function bankNameToken(provider: string): string {
  const name = words(provider).split(" ");
  const by = name.indexOf("BY");
  return (by > 0 ? name.slice(0, by) : name).filter((w) => w && !BANK_FILLER.has(w)).join(" ");
}

// The day to pay: three business days before it's due (five through a bank's own bill pay), and
// never before today. Weekends move it earlier, to a business day.
export function payOnFor(
  dueOn: string,
  { today, viaBankBillPay = false }: { today: string; viaBankBillPay?: boolean },
): string {
  const lead = viaBankBillPay
    ? MANUAL_PAY_BANK_BILL_PAY_LEAD_BUSINESS_DAYS
    : MANUAL_PAY_LEAD_BUSINESS_DAYS;
  const payOn = addBusinessDays(dueOn, -lead);
  return payOn < today ? today : payOn;
}

export type BankLine = {
  id: string;
  date: string;
  // Plaid's sign: positive is money out.
  amountCents: number;
  description: string;
  merchantName: string | null;
  accountId: string;
};

const lineText = (line: BankLine) => words(`${line.description} ${line.merchantName ?? ""}`);
const AUTOPAY = /\bAUTO ?PAY(MENT)?\b|\bAUTO ?PYMT\b/;

const namesBiller = (line: BankLine, biller: Biller) => {
  const text = ` ${lineText(line)} `;
  return biller.matchTokens.some((token) => text.includes(` ${words(token)} `));
};

// Whether autopay already pays this biller: an autopay line naming it, out of the account, lately.
// Paying by hand on top would pay twice (Chase mortgage autopay still withdraws after a manual
// payment). Buy now, pay later is on autopay unless the person turned it off.
export function autopayCovers(
  biller: Biller,
  lines: readonly BankLine[],
  { today }: { today: string },
): boolean {
  if (biller.autopayByDefault) return true;
  const since = iso(new Date(dayOf(today).getTime() - MANUAL_PAY_AUTOPAY_LOOKBACK_DAYS * DAY));
  return lines.some(
    (line) =>
      line.amountCents > 0 &&
      line.date >= since &&
      AUTOPAY.test(lineText(line)) &&
      namesBiller(line, biller),
  );
}

export type Settlement = { lineId: string; confidence: "amount_and_days" | "amount_days_and_name" };

// The bank line that is this payment, if it has posted. The key is the exact amount Jane prefilled
// (or that plus the biller's documented fee), out of the account it was to come from, from the pay
// day to settleBusinessDays after it. A name in the line only adds confidence: descriptors vary by
// bank. Lines already matched to another payment are passed in `taken`.
export function findSettlement(
  payment: { biller: Biller; amountCents: number; payOn: string; accountId: string | null },
  lines: readonly BankLine[],
  taken: ReadonlySet<string> = new Set(),
): Settlement | null {
  const last = addBusinessDays(payment.payOn, payment.biller.settleBusinessDays);
  const amounts = new Set([payment.amountCents, payment.amountCents + payment.biller.feeCents]);
  const candidates = lines.filter(
    (line) =>
      !taken.has(line.id) &&
      amounts.has(line.amountCents) &&
      line.date >= payment.payOn &&
      line.date <= last &&
      (payment.accountId === null || line.accountId === payment.accountId),
  );
  const named = candidates.find((line) => namesBiller(line, payment.biller));
  if (named) return { lineId: named.id, confidence: "amount_days_and_name" };
  // Two lines of the same amount and days with no name between them: too unsure to call it.
  if (candidates.length === 1) return { lineId: candidates[0]!.id, confidence: "amount_and_days" };
  return null;
}

// The two lines of a move between the person's own accounts: out of one, the same amount into the
// other, from the day to MANUAL_TRANSFER_SETTLE_BUSINESS_DAYS after. Both sides, always: one line
// of that amount could be anything (security review on #1508: a Zelle to a landlord isn't a move
// to savings). Exact cents only: a transfer has no fee.
export function findTransferSettlement(
  move: {
    amountCents: number;
    on: string;
    fromAccountId: string;
    toAccountId: string;
    settleBusinessDays: number;
  },
  lines: readonly BankLine[],
  taken: ReadonlySet<string> = new Set(),
): { lineIds: [string, string] } | null {
  const last = addBusinessDays(move.on, move.settleBusinessDays);
  const inWindow = (line: BankLine) =>
    !taken.has(line.id) && line.date >= move.on && line.date <= last;
  const out = lines.filter(
    (l) => inWindow(l) && l.accountId === move.fromAccountId && l.amountCents === move.amountCents,
  );
  const into = lines.filter(
    (l) => inWindow(l) && l.accountId === move.toAccountId && l.amountCents === -move.amountCents,
  );
  // Each side must be one line, so two equal moves in a window aren't guessed.
  if (out.length !== 1 || into.length !== 1) return null;
  return { lineIds: [out[0]!.id, into[0]!.id] };
}
