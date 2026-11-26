import { SAME_ACCOUNT_BALANCE_SLACK_DAYS, SAME_ACCOUNT_MAX_LINES } from "@/config/detection";
import { readCsvFile, type CsvFile } from "@/data-sources/csv/csv-source";
import type { ScopedDb } from "@/lib/db-scoped";
import { namesBank } from "@/lib/import/wrong-account";
import { balanceOnOrBefore, compareAccounts, type Verdict } from "@/planning/same-account";

// Before an upload, /import says whether a file is a linked account's. That is the decision net
// worth makes once the file is in (src/lib/account-copies.ts): the file's lines and closing balance
// against the linked account's, by src/planning/same-account.ts. The note follows it instead of
// guessing from the bank's name (walk 23: a savings file was told "skip it" for a linked checking
// account, which would have left $5,120.00 of savings out of net worth).
// The result: for each file by its position (two files can share a name), the verdict against each
// linked account of its bank, by account id.
export type LinkedVerdicts = Record<string, Verdict>[];

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function linkedVerdicts(
  db: Pick<ScopedDb, "accounts" | "transactions" | "balanceSnapshots">,
  files: readonly CsvFile[],
): Promise<LinkedVerdicts> {
  const read = files.flatMap((f, index) => {
    const r = readCsvFile(f);
    return r.ok && r.format.bank ? [{ ...r, bank: r.format.bank, index }] : [];
  });
  if (read.length === 0) return [];
  const links = await db.accounts.findMany({
    where: { source: "plaid" },
    select: { id: true, item: { select: { institutionName: true } } },
  });
  const out: LinkedVerdicts = [];
  for (const file of read) {
    const near = links.filter(
      (l) => l.item?.institutionName && namesBank(l.item.institutionName, file.bank),
    );
    const mine = file.transactions.map((t) => ({ date: t.date, amountCents: t.amountCents }));
    const last = [...(file.balances ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
    for (const link of near) {
      const [rows, readings] = await Promise.all([
        db.transactions.findMany({
          where: { accountId: link.id, pending: false },
          select: { date: true, amountCents: true },
          orderBy: [{ date: "desc" }, { amountCents: "desc" }],
          take: SAME_ACCOUNT_MAX_LINES + 1,
        }),
        db.balanceSnapshots.findMany({
          where: { accountId: link.id },
          select: { date: true, balanceCents: true },
        }),
      ]);
      const history = readings.map((r) => ({ date: day(r.date), balanceCents: r.balanceCents }));
      const { verdict } = compareAccounts({
        upload: mine,
        link: rows
          .slice(0, SAME_ACCOUNT_MAX_LINES)
          .map((r) => ({ date: day(r.date), amountCents: r.amountCents })),
        truncated: rows.length > SAME_ACCOUNT_MAX_LINES || mine.length > SAME_ACCOUNT_MAX_LINES,
        closing: last ? { date: last.date, cents: last.balanceCents } : null,
        linkBalanceOn: (date) => balanceOnOrBefore(history, date, SAME_ACCOUNT_BALANCE_SLACK_DAYS),
      });
      (out[file.index] ??= {})[link.id] = verdict;
    }
  }
  return out;
}
