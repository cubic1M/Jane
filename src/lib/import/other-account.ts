import { OTHER_ACCOUNT_MIN_ROWS, OTHER_ACCOUNT_MIN_SHARE } from "@/config/import";
import { readCsvFile, type CsvFile } from "@/data-sources/csv/csv-source";
import type { ScopedDb } from "@/lib/db-scoped";
import { crossFormatTwins, type RowFacts } from "./cross-format";

// /import says an overlapping file is safe, and into the same account it is, but right after a first
// upload the choice stays "A new account" (the next file is often another bank's). A second export
// of the same bank then made a second account, and everything in both counted twice (debugger
// 11-03: net worth $34,806 for someone with $18,494). So a preview into a new account says when
// the file's rows are already in another one, and offers it. Asked, not decided: it's the person's
// money and their choice.
export type AlreadyIn = { accountId: string; name: string; rows: number; ofRows: number };

export async function alreadyInAnotherAccount(
  db: ScopedDb,
  files: readonly CsvFile[],
): Promise<AlreadyIn | null> {
  const incoming: RowFacts[] = files.flatMap((file) => {
    const read = readCsvFile(file);
    return read.ok
      ? read.transactions.map((t) => ({
          key: t.externalId,
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
        }))
      : [];
  });
  if (incoming.length < OTHER_ACCOUNT_MIN_ROWS) return null;
  const days = incoming.map((r) => r.date).sort();
  const [accounts, stored] = await Promise.all([
    db.accounts.findMany({ select: { id: true, name: true } }),
    db.transactions.findMany({
      where: {
        date: {
          // A day either side: the matching allows for a posting date beside a transaction date.
          gte: new Date(Date.parse(`${days[0]}T00:00:00Z`) - 86_400_000),
          lte: new Date(Date.parse(`${days[days.length - 1]}T00:00:00Z`) + 86_400_000),
        },
      },
      select: {
        accountId: true,
        dedupeKey: true,
        date: true,
        amountCents: true,
        description: true,
      },
    }),
  ]);
  const best = accounts
    .map((account) => ({
      account,
      rows: crossFormatTwins(
        stored
          .filter((t) => t.accountId === account.id)
          .map((t) => ({
            key: t.dedupeKey ?? "",
            date: t.date.toISOString().slice(0, 10),
            amountCents: t.amountCents,
            description: t.description,
          })),
        incoming,
        { anyFormat: true },
      ).size,
    }))
    .sort((a, b) => b.rows - a.rows)[0];
  if (
    !best ||
    best.rows < OTHER_ACCOUNT_MIN_ROWS ||
    best.rows / incoming.length < OTHER_ACCOUNT_MIN_SHARE
  ) {
    return null;
  }
  return {
    accountId: best.account.id,
    name: best.account.name,
    rows: best.rows,
    ofRows: incoming.length,
  };
}
