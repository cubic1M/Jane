import {
  CARD_ISSUERS,
  CARD_ISSUER_SHORT,
  CARD_PAYMENT_MATCH_DAYS,
  CARD_PAYMENT_NAME,
} from "@/config/detection";
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

// Each card payment with the bank-account outflow that paid it, from the candidate outflows.
// Each card payment pays for one outflow, the nearest in date; one already called a card
// payment goes first.
function pairPayments(
  rows: readonly PairableRow[],
  type: ReadonlyMap<string, string>,
  isCandidate: (r: PairableRow) => boolean,
): { payment: PairableRow; outflow: PairableRow }[] {
  const payments = rows
    .filter(
      (r) =>
        type.get(r.accountId) === "credit" && r.amountCents < 0 && r.pfcDetailed === CARD_PAYMENT,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const outflows = rows.filter(
    (r) => type.get(r.accountId) === "depository" && r.amountCents > 0 && isCandidate(r),
  );
  const used = new Set<string>();
  const pairs: { payment: PairableRow; outflow: PairableRow }[] = [];
  for (const payment of payments) {
    const match = outflows
      .filter(
        (o) =>
          !used.has(o.id) &&
          o.amountCents === -payment.amountCents &&
          days(o.date, payment.date) <= CARD_PAYMENT_MATCH_DAYS,
      )
      .sort(
        (a, b) =>
          Number(b.pfcDetailed === CARD_PAYMENT) - Number(a.pfcDetailed === CARD_PAYMENT) ||
          days(a.date, payment.date) - days(b.date, payment.date) ||
          a.id.localeCompare(b.id),
      )[0];
    if (!match) continue;
    used.add(match.id);
    pairs.push({ payment, outflow: match });
  }
  return pairs;
}

// The ids of bank-account outflows that paid a card and aren't called card payments yet.
export function cardPaymentOutflows(
  rows: readonly PairableRow[],
  accounts: readonly { id: string; type: string }[],
): string[] {
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  return pairPayments(
    rows,
    type,
    (r) => r.pfcDetailed === null || r.pfcDetailed === CARD_PAYMENT || r.categorySource === "llm",
  )
    .filter(({ outflow }) => outflow.pfcDetailed !== CARD_PAYMENT)
    .map(({ outflow }) => outflow.id);
}

// A card payment out of a bank account, named from its words when its card's side isn't known:
// the card of the company the payment names, else "Chase card payment", else the plain name (a
// lone card isn't assumed: the payment may be to one Jane hasn't seen).
export function cardPaymentNameFromWords(
  said: string,
  accounts: readonly { type: string; name: string }[],
): string {
  const issuer = CARD_ISSUERS.find(([pattern]) => pattern.test(said))?.[1];
  if (!issuer) return CARD_PAYMENT_NAME;
  const named = accounts.find(
    (a) =>
      a.type === "credit" &&
      [issuer, ...(CARD_ISSUER_SHORT[issuer] ?? [])].some((n) =>
        a.name.toLowerCase().includes(n.toLowerCase()),
      ),
  );
  return named ? `${named.name} payment` : `${issuer} card payment`;
}

// What to call card payments in a list (QA round 32): both sides are named for the card they
// paid, "Chase card payment", not the bank's words ("CHASE CREDIT CRD AUTOPAY", "Payment Thank
// You Web"). The card's own side always knows its card; a bank outflow is named for the card
// payment it pairs with, else from its own words. Keyed by transaction id.
export function cardPaymentNames(
  rows: readonly (PairableRow & { description?: string })[],
  accounts: readonly { id: string; type: string; name: string }[],
): Map<string, string> {
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const name = new Map(accounts.map((a) => [a.id, a.name]));
  const label = (cardId: string) => `${name.get(cardId)} payment`;
  const names = new Map<string, string>();
  for (const r of rows) {
    if (r.pfcDetailed !== CARD_PAYMENT) continue;
    if (type.get(r.accountId) === "credit") {
      if (r.amountCents < 0) names.set(r.id, label(r.accountId));
    } else if (r.amountCents > 0 && r.description !== undefined) {
      // The bank's own words say more than a plain "Credit card payment".
      const named = cardPaymentNameFromWords(r.description, accounts);
      if (named !== CARD_PAYMENT_NAME) names.set(r.id, named);
    }
  }
  for (const { payment, outflow } of pairPayments(
    rows,
    type,
    (r) => r.pfcDetailed === CARD_PAYMENT,
  ))
    names.set(outflow.id, label(payment.accountId));
  return names;
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
