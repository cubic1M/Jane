import { parseKey } from "@/detection/unusual";
import type { PrismaClient } from "@/generated/prisma/client";
import { evidenceRefs } from "@/lib/finding-accounts";
import { systemDb } from "@/lib/system-db";
import type { PersonTx } from "@/lib/db-scoped";

// What the person (or their household) has hung on a transaction row, so a row that carries any of it is
// never deleted by the move to a fuller link (src/lib/plaid/replace.ts) or by the clean-up of a pending
// charge. Read from prisma/schema.prisma, every table that points at a transaction row:
//   - the row itself: a category the person set (categorySource "user", alone or as a rule for the
//     merchant) and a deposit placement (incomePlacement: "declined" is "not income", "edited");
//   - tax_tags (FK, cascades), hsa_receipts (FK, cascades), sudden_money (FK, cascades);
//   - goal_transfers (a plain id, no FK: a transfer counted toward a goal);
//   - shared_charges (a plain id, no FK, may be written by the household partner: a charge two partners
//     split).
//   - plain ids kept as text or JSON by what was built from the charge, each read for the person:
//     suggestion_outcomes.evidence_tx_ids and held_evidence_tx_ids (the verified savings record),
//     month_closes.uncertain, alerts of type unusual_activity (the key holds the transaction id),
//     findings.evidence (transaction ids inside the JSON), tax_profiles.refunds_handled and
//     giving_receipts. recurring_streams.transaction_ids hold Plaid ids and are worked out again by every sync.
// The transaction table has no note or split column; a "split" is shared_charges.
const CHUNK = 2000;

const WHY =
  "Replacing a bank link: a charge a household partner shared hangs on a transaction of this person";

export type RowFacts = {
  id: string;
  categorySource: string | null;
  incomePlacement: string | null;
};

// Every transaction id the person's derived rows name (see above), as one set.
async function namedByDerivedRows(tx: PersonTx, userId: string): Promise<Set<string>> {
  const [outcomes, closes, alerts, findings, profiles] = await Promise.all([
    tx.suggestionOutcome.findMany({
      where: { userId },
      select: { evidenceTxIds: true, heldEvidenceTxIds: true },
    }),
    tx.monthClose.findMany({ where: { userId }, select: { uncertain: true } }),
    tx.alert.findMany({ where: { userId, type: "unusual_activity" }, select: { key: true } }),
    tx.finding.findMany({ where: { userId }, select: { evidence: true } }),
    tx.taxProfile.findMany({
      where: { userId },
      select: { refundsHandled: true, givingReceipts: true },
    }),
  ]);
  const named = new Set<string>();
  for (const o of outcomes)
    for (const id of [...o.evidenceTxIds, ...o.heldEvidenceTxIds]) named.add(id);
  for (const c of closes) for (const id of c.uncertain) named.add(id);
  for (const a of alerts) {
    const parsed = parseKey(a.key);
    if (parsed) named.add(parsed.transactionId);
  }
  for (const f of findings) for (const id of evidenceRefs(f.evidence).transactionIds) named.add(id);
  for (const p of profiles)
    for (const id of [...p.refundsHandled, ...p.givingReceipts]) named.add(id);
  return named;
}

// The ids among `rows` that have anything of the person's on them.
export async function touchedIds(
  tx: PersonTx,
  userId: string,
  rows: readonly RowFacts[],
  client: PrismaClient,
): Promise<Set<string>> {
  const out = new Set(
    rows.filter((r) => r.categorySource === "user" || r.incomePlacement !== null).map((r) => r.id),
  );
  const ids = rows.map((r) => r.id).filter((id) => !out.has(id));
  if (ids.length > 0) {
    const named = await namedByDerivedRows(tx, userId);
    for (const id of ids) if (named.has(id)) out.add(id);
  }
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const where = { transactionId: { in: part } };
    const [tags, receipts, sudden, goals, shared] = await Promise.all([
      tx.taxTag.findMany({ where: { userId, ...where }, select: { transactionId: true } }),
      tx.hsaReceipt.findMany({ where: { userId, ...where }, select: { transactionId: true } }),
      tx.suddenMoney.findMany({ where: { userId, ...where }, select: { transactionId: true } }),
      tx.goalTransfer.findMany({ where: { userId, ...where }, select: { transactionId: true } }),
      systemDb(WHY, client).sharedCharge.findMany({ where, select: { transactionId: true } }),
    ]);
    for (const list of [tags, receipts, sudden, goals, shared]) {
      for (const r of list) if (r.transactionId) out.add(r.transactionId);
    }
  }
  return out;
}
