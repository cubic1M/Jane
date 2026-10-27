import { CARD_PAYMENT_MATCH_DAYS } from "@/config/detection";
import { DAY_MS, isoDay } from "@/lib/dates";
import type { ScopedDb } from "@/lib/db-scoped";

// A card payment, found from the card's side (accuracy bench). The card always says what a
// payment is ("Payment Thank You", the bank's "Payment" type), but checking says whatever the
// card company wrote, and the keyword rules only know the big ones. So an outflow from a bank
// account of the same amount, within CARD_PAYMENT_MATCH_DAYS of the card's payment, is the money
// that paid it. Each card payment pays for one outflow, the nearest in date. Only outflows with
// no category, or one Claude guessed, are changed; the person's own and Plaid's stand.

const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

export type PairableRow = {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  pfcDetailed: string | null;
  categorySource?: string | null;
};

const days = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

// The ids of bank-account outflows that paid a card and aren't called card payments yet.
export function cardPaymentOutflows(
  rows: readonly PairableRow[],
  accounts: readonly { id: string; type: string }[],
): string[] {
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const payments = rows
    .filter(
      (r) =>
        type.get(r.accountId) === "credit" && r.amountCents < 0 && r.pfcDetailed === CARD_PAYMENT,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const outflows = rows.filter(
    (r) =>
      type.get(r.accountId) === "depository" &&
      r.amountCents > 0 &&
      (r.pfcDetailed === null || r.pfcDetailed === CARD_PAYMENT || r.categorySource === "llm"),
  );
  const used = new Set<string>();
  const found: string[] = [];
  for (const payment of payments) {
    const match = outflows
      .filter(
        (o) =>
          !used.has(o.id) &&
          o.amountCents === -payment.amountCents &&
          days(o.date, payment.date) <= CARD_PAYMENT_MATCH_DAYS,
      )
      // One already called a card payment first, then the nearest in date.
      .sort(
        (a, b) =>
          Number(b.pfcDetailed === CARD_PAYMENT) - Number(a.pfcDetailed === CARD_PAYMENT) ||
          days(a.date, payment.date) - days(b.date, payment.date) ||
          a.id.localeCompare(b.id),
      )[0];
    if (!match) continue;
    used.add(match.id);
    if (match.pfcDetailed !== CARD_PAYMENT) found.push(match.id);
  }
  return found;
}

// After an import: every one of the person's card payments, matched to what paid it.
export async function matchCardPayments(
  db: Pick<ScopedDb, "accounts" | "transactions">,
): Promise<number> {
  const accounts = await db.accounts.findMany({ select: { id: true, type: true } });
  if (!accounts.some((a) => a.type === "credit")) return 0;
  const rows = await db.transactions.findMany({
    where: {
      OR: [
        { pfcDetailed: CARD_PAYMENT },
        { pfcDetailed: null, amountCents: { gt: 0 } },
        { categorySource: "llm", amountCents: { gt: 0 } },
      ],
    },
    select: {
      id: true,
      accountId: true,
      date: true,
      amountCents: true,
      pfcDetailed: true,
      categorySource: true,
    },
  });
  const ids = cardPaymentOutflows(
    rows.map((r) => ({ ...r, date: isoDay(r.date) })),
    accounts,
  );
  if (ids.length === 0) return 0;
  const { count } = await db.transactions.updateMany({
    where: { id: { in: ids } },
    data: {
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: CARD_PAYMENT,
      categorySource: "rule",
    },
  });
  return count;
}
