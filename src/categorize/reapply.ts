import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { REGULAR_PAYER_OWN_MONEY_DAYS } from "@/config/detection";
import { dayNumber } from "@/detection/units";
import { isoDay } from "@/lib/dates";
import { categorizeByRules, payFiledAsBought, payoutByRules } from "./rules";

const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

// Which saved rows this pass may change. The write asks the same question again, so a person's
// edit that lands between the read and the write keeps their category.
const ELIGIBLE = {
  OR: [
    { categorySource: "rule" },
    { categorySource: null },
    { categorySource: { in: ["plaid", "llm"] }, amountCents: { lt: 0 } },
  ],
} satisfies Prisma.TransactionWhereInput;

// The keyword rules get better (overnight upload QA: rent paid by Zelle was a transfer, a
// savings transfer was spending). New uploads get them at once; this brings the rows already
// saved up to date. Only rows the rules placed, or nobody placed, change: a person's own
// choice, Claude's and the bank's stay, and a card payment found by its timing stays one.
// A payout for work done on one's own (./rules.ts payoutByRules) is income whoever labelled it,
// except the person. Returns how many rows changed.
export async function reapplyRules(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const rows = await db.transactions.findMany({
    where: ELIGIBLE,
    select: {
      id: true,
      accountId: true,
      date: true,
      description: true,
      amountCents: true,
      pfcDetailed: true,
      pfcPrimary: true,
      categorySource: true,
    },
  });
  const moves = new Map<string, { primary: string; ids: string[] }>();
  const ownMoneyIn: { id: string; accountId: string; date: string; amountCents: number }[] = [];
  for (const t of rows) {
    if (t.pfcDetailed === CARD_PAYMENT) continue;
    const input = { description: t.description, amountCents: t.amountCents, hints: {} };
    const placedByOthers = t.categorySource === "plaid" || t.categorySource === "llm";
    if (placedByOthers && t.pfcPrimary === "INCOME") continue;
    const category = placedByOthers
      ? (payoutByRules(input) ?? payFiledAsBought(input, t.pfcPrimary))
      : categorizeByRules(input);
    if (!category || category.detailed === t.pfcDetailed) continue;
    // Regular money by Zelle that regular-payers.ts made income: the rules only see a transfer, and
    // moving it back would re-sort it, and run detection again, every night (debugger 11-02). Unless
    // the same amount left another of the person's accounts about then: that is a move of their own
    // money, which was income only because that other account's statement wasn't here yet.
    if (t.pfcDetailed === "INCOME_OTHER" && category.detailed === "TRANSFER_IN_ACCOUNT_TRANSFER") {
      if (t.amountCents < 0) ownMoneyIn.push({ ...t, date: isoDay(t.date) });
      continue;
    }
    const move = moves.get(category.detailed) ?? { primary: category.primary, ids: [] };
    move.ids.push(t.id);
    moves.set(category.detailed, move);
  }
  const own = await ownMoney(db, ownMoneyIn);
  if (own.length > 0) {
    const group = moves.get("TRANSFER_IN_ACCOUNT_TRANSFER") ?? { primary: "TRANSFER_IN", ids: [] };
    group.ids.push(...own);
    moves.set("TRANSFER_IN_ACCOUNT_TRANSFER", group);
  }
  let changed = 0;
  for (const [detailed, { primary, ids }] of moves) {
    const { count } = await db.transactions.updateMany({
      where: { AND: [{ id: { in: ids } }, ELIGIBLE] },
      data: { pfcPrimary: primary, pfcDetailed: detailed, categorySource: "rule" },
    });
    changed += count;
  }
  return changed;
}

// The income rows that are a move between the person's own accounts: the same amount left another
// account within REGULAR_PAYER_OWN_MONEY_DAYS. Each outgoing row explains one incoming row, across
// runs too: money in already placed as a transfer has its outgoing row first, so an earlier run's
// conversion is never paired with that same outgoing row again.
async function ownMoney(
  db: ReturnType<typeof scopedFor>,
  incoming: readonly { id: string; accountId: string; date: string; amountCents: number }[],
): Promise<string[]> {
  if (incoming.length === 0) return [];
  const amounts = [...new Set(incoming.map((r) => -r.amountCents))];
  const [out, placed] = await Promise.all([
    db.transactions.findMany({
      where: { pending: false, amountCents: { in: amounts } },
      select: { id: true, accountId: true, date: true, amountCents: true },
    }),
    db.transactions.findMany({
      where: {
        pending: false,
        pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
        amountCents: { in: incoming.map((r) => r.amountCents) },
        id: { notIn: incoming.map((r) => r.id) },
      },
      select: { accountId: true, date: true, amountCents: true },
    }),
  ]);
  const used = new Set<string>();
  const explains = (
    row: { accountId: string; date: string; amountCents: number },
    o: (typeof out)[number],
  ) =>
    !used.has(o.id) &&
    o.accountId !== row.accountId &&
    o.amountCents === -row.amountCents &&
    Math.abs(dayNumber(isoDay(o.date)) - dayNumber(row.date)) <= REGULAR_PAYER_OWN_MONEY_DAYS;
  for (const row of placed) {
    const taken = out.find((o) => explains({ ...row, date: isoDay(row.date) }, o));
    if (taken) used.add(taken.id);
  }
  const ids: string[] = [];
  for (const row of incoming) {
    const match = out.find((o) => explains(row, o));
    if (!match) continue;
    used.add(match.id);
    ids.push(row.id);
  }
  return ids;
}
