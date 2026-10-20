import { ESSENTIAL_WORDS, type EssentialGroup } from "@/config/tight-money";
import { LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";
import { formatCents } from "@/lib/money";

// When money is tight (spec step 177). Pure: the first day the checking forecast dips under
// its cushion, the bills before then with essentials first, and the requests Jane would
// make, each written out for the person to send with a tap.

export type Day = { date: string; balanceCents: number };

export type Shortfall = { date: string; balanceCents: number; shortCents: number };

// The first day the forecast goes under the cushion, or null.
export function firstShortfall(days: readonly Day[]): Shortfall | null {
  const day = days.find((d) => d.balanceCents < LOW_BALANCE_CUSHION_CENTS);
  return day
    ? {
        date: day.date,
        balanceCents: day.balanceCents,
        shortCents: LOW_BALANCE_CUSHION_CENTS - day.balanceCents,
      }
    : null;
}

export function essentialGroup(payee: string): EssentialGroup | null {
  const text = payee.toLowerCase();
  for (const [group, words] of Object.entries(ESSENTIAL_WORDS)) {
    if (words.some((w) => text.includes(w))) return group as EssentialGroup;
  }
  return null;
}

export type Bill = { payee: string; date: string; amountCents: number };
export type OrderedBill = Bill & { essential: EssentialGroup | null };

// Housing, utilities and insurance first, then the rest by date.
export function payFirst(bills: readonly Bill[]): OrderedBill[] {
  return bills
    .map((b) => ({ ...b, essential: essentialGroup(b.payee) }))
    .sort(
      (a, b) =>
        Number(b.essential !== null) - Number(a.essential !== null) ||
        a.date.localeCompare(b.date) ||
        a.payee.localeCompare(b.payee),
    );
}

export type TightDebt = {
  key: string;
  name: string;
  kind: "card" | "student" | "auto" | "loan" | "mortgage";
  balanceCents: number | null;
  aprBps: number | null;
  paymentCents: number | null;
  nextDue: string | null;
};

export type TightKind = "due_move" | "hardship" | "lower_rate" | "waive_fee";

export type TightItem = {
  // "<kind>:<debt key>", the same for a shortfall's whole life.
  id: string;
  kind: TightKind;
  debtKey: string;
  debtName: string;
  label: string;
  // The request, written out for the person to read before sending.
  body: string;
  // What it could free up before the shortfall, in cents; null when it isn't a payment.
  freesCents: number | null;
};

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// Items Jane prepares for this shortfall. Never an essential, and a mortgage is housing:
// it's paid first, not asked to wait. `lateFee` is a late fee on a card in the last two
// months, `paydayDay` the day of the month of the next paycheck.
export function tightItems(input: {
  debts: readonly TightDebt[];
  shortfallOn: string;
  paydayDay: number | null;
  lateFees: readonly { debtKey: string; cents: number }[];
}): TightItem[] {
  const out: TightItem[] = [];
  for (const d of input.debts) {
    if (d.kind === "mortgage") continue;
    const dueBefore = d.nextDue !== null && d.nextDue <= input.shortfallOn && d.paymentCents;
    if (dueBefore && input.paydayDay !== null) {
      const day = Number(d.nextDue!.slice(8, 10));
      const newDay = ((input.paydayDay + 2 - 1) % 28) + 1;
      out.push({
        id: `due_move:${d.key}`,
        kind: "due_move",
        debtKey: d.key,
        debtName: d.name,
        label: `Move the ${d.name} due date to the ${ordinal(newDay)}`,
        body: `Hello, I'd like to change the monthly payment due date on my account (${d.name}) from the ${ordinal(day)} to the ${ordinal(newDay)} of each month, so it comes after my paycheck. Please confirm the new date and whether the next payment changes. Thank you.`,
        freesCents: d.paymentCents,
      });
    }
    if ((d.balanceCents ?? 0) > 0) {
      out.push({
        id: `hardship:${d.key}`,
        kind: "hardship",
        debtKey: d.key,
        debtName: d.name,
        label: `Ask ${d.name} about a hardship program`,
        body: `Hello, money is tight for me right now and I'd like to know what hardship options you offer on my account (${d.name}): a lower or paused payment for a few months, a reduced interest rate, or a payment plan. I want to keep paying and avoid missing a payment. Please tell me what you can do and what I'd need to send. Thank you.`,
        freesCents: d.paymentCents,
      });
    }
    if (d.kind === "card" && (d.aprBps ?? 0) >= 1_500) {
      out.push({
        id: `lower_rate:${d.key}`,
        kind: "lower_rate",
        debtKey: d.key,
        debtName: d.name,
        label: `Ask ${d.name} for a lower rate`,
        body: `Hello, I've been a customer for a while and my account (${d.name}) is charged ${((d.aprBps ?? 0) / 100).toFixed(2)}% interest. I'd like to ask for a lower rate. Please tell me what you can offer. Thank you.`,
        freesCents: null,
      });
    }
  }
  for (const fee of input.lateFees) {
    const debt = input.debts.find((d) => d.key === fee.debtKey);
    if (!debt) continue;
    out.push({
      id: `waive_fee:${debt.key}`,
      kind: "waive_fee",
      debtKey: debt.key,
      debtName: debt.name,
      label: `Ask ${debt.name} to waive its ${formatCents(fee.cents)} late fee`,
      body: `Hello, a late fee of ${formatCents(fee.cents)} was charged on my account (${debt.name}). I'd like to ask you to waive it as a one-time courtesy; I'll make sure future payments are on time. Please confirm. Thank you.`,
      freesCents: fee.cents,
    });
  }
  return out;
}
