import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { categorizeByRules, payoutByRules } from "./rules";

const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

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
    where: {
      OR: [
        { categorySource: "rule" },
        { categorySource: null },
        { categorySource: { in: ["plaid", "llm"] }, amountCents: { lt: 0 } },
      ],
    },
    select: {
      id: true,
      description: true,
      amountCents: true,
      pfcDetailed: true,
      pfcPrimary: true,
      categorySource: true,
    },
  });
  const moves = new Map<string, { primary: string; ids: string[] }>();
  for (const t of rows) {
    if (t.pfcDetailed === CARD_PAYMENT) continue;
    const input = { description: t.description, amountCents: t.amountCents, hints: {} };
    const placedByOthers = t.categorySource === "plaid" || t.categorySource === "llm";
    if (placedByOthers && t.pfcPrimary === "INCOME") continue;
    const category = placedByOthers ? payoutByRules(input) : categorizeByRules(input);
    if (!category || category.detailed === t.pfcDetailed) continue;
    const move = moves.get(category.detailed) ?? { primary: category.primary, ids: [] };
    move.ids.push(t.id);
    moves.set(category.detailed, move);
  }
  let changed = 0;
  for (const [detailed, { primary, ids }] of moves) {
    const { count } = await db.transactions.updateMany({
      where: { id: { in: ids } },
      data: { pfcPrimary: primary, pfcDetailed: detailed, categorySource: "rule" },
    });
    changed += count;
  }
  return changed;
}
