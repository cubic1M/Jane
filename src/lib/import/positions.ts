import { NOT_A_STATEMENT, notAStatement, type CsvFile } from "@/data-sources/csv/csv-source";
import {
  POSITIONS_LAYOUTS,
  readPositionsFile,
  type ParsedPosition,
  type ParsedPositionsAccount,
  type PositionsFile,
} from "@/data-sources/csv/positions";
import { isPositionsSubtype } from "@/config/positions-import";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db-scoped";

// Uploading a brokerage's positions download on /import (src/data-sources/csv/positions.ts):
// the preview, then the accounts, securities and holdings it makes, which the investments
// page, net worth and the investing checks read like a linked brokerage's. Files are read in
// memory and never stored. A newer download of the same account replaces what it holds.

// The form field for an account's type: one per account across the files.
export const accountKey = (layout: string, ref: string) => `${layout}:${ref}`;
export const subtypeField = (key: string) => `subtype.${key}`;

export type PositionsAccountPreview = {
  key: string;
  name: string;
  subtype: string;
  // Already uploaded before: this download replaces what it holds.
  replaces: boolean;
  valueCents: number;
  cashCents: number;
  holdings: number;
  largest: { name: string; ticker: string | null; valueCents: number }[];
};

export type PositionsFilePreview =
  | {
      ok: true;
      file: string;
      layout: string;
      asOf: string | null;
      skipped: number;
      notes: string[];
      accounts: PositionsAccountPreview[];
    }
  | { ok: false; file: string; error: string };

const LARGEST = 3;

function readFile(file: CsvFile): PositionsFile | { error: string } {
  if (notAStatement(file.text)) return { error: NOT_A_STATEMENT };
  return readPositionsFile(file.text);
}

// What each file holds, without saving anything.
export async function previewPositionsFiles(
  db: ScopedDb,
  files: CsvFile[],
): Promise<PositionsFilePreview[]> {
  // Accounts uploaded before, by name, with the type the person gave them.
  const existing = new Map(
    (
      await db.accounts.findMany({
        where: { source: "csv", type: "investment" },
        select: { name: true, subtype: true },
      })
    ).map((a) => [a.name, a.subtype]),
  );
  return files.map((file) => {
    const read = readFile(file);
    if ("error" in read) return { ok: false, file: file.name, error: read.error };
    return {
      ok: true,
      file: file.name,
      layout: POSITIONS_LAYOUTS[read.layout],
      asOf: read.asOf,
      skipped: read.skipped,
      notes: read.notes,
      accounts: read.accounts.map((a) => ({
        key: accountKey(read.layout, a.ref),
        name: a.name,
        subtype: existing.get(a.name) ?? a.subtype,
        replaces: existing.has(a.name),
        valueCents: a.valueCents,
        cashCents: a.cashCents,
        holdings: a.positions.length,
        largest: [...a.positions]
          .sort((x, y) => y.valueCents - x.valueCents)
          .slice(0, LARGEST)
          .map((p) => ({ name: p.name, ticker: p.ticker, valueCents: p.valueCents })),
      })),
    };
  });
}

export type PositionsImportResult =
  | { ok: true; accounts: number; holdings: number; valueCents: number }
  | { ok: false; error: string };

// A security's own id for uploads: its ticker, or its name when the file gives none, so the
// same fund in two accounts or two downloads is one security. Never a Plaid id.
export function fileSecurityRef(p: Pick<ParsedPosition, "ticker" | "name" | "isCash">): string {
  if (p.ticker) return `file:${p.ticker}`;
  if (p.isCash) return "file:cash";
  return `file:name:${p.name.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

// One row per security: Fidelity lists a fund twice when some is held on margin.
function merged(positions: ParsedPosition[]) {
  const byRef = new Map<string, ParsedPosition>();
  for (const p of positions) {
    const ref = fileSecurityRef(p);
    const seen = byRef.get(ref);
    if (!seen) {
      byRef.set(ref, { ...p });
      continue;
    }
    seen.quantity += p.quantity;
    seen.valueCents += p.valueCents;
    seen.costBasisCents =
      seen.costBasisCents === null || p.costBasisCents === null
        ? null
        : seen.costBasisCents + p.costBasisCents;
  }
  return [...byRef.entries()];
}

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Saves every account in the files, or nothing when one doesn't read. `subtypes` are the
// account types the person picked, by account key.
export async function importPositionsFiles(
  db: ScopedDb,
  files: CsvFile[],
  { subtypes = {}, now = new Date() }: { subtypes?: Record<string, unknown>; now?: Date } = {},
): Promise<PositionsImportResult> {
  const read: PositionsFile[] = [];
  for (const file of files) {
    const result = readFile(file);
    if ("error" in result) return { ok: false, error: `${file.name}: ${result.error}` };
    read.push(result);
  }
  const today = now.toISOString().slice(0, 10);
  let holdings = 0;
  let valueCents = 0;
  let accounts = 0;
  for (const file of read) {
    // A download dated after today is today's (a clock ahead of ours).
    const asOf = file.asOf && file.asOf <= today ? file.asOf : today;
    for (const account of file.accounts) {
      const chosen = subtypes[accountKey(file.layout, account.ref)];
      await saveAccount(db, account, isPositionsSubtype(chosen) ? chosen : null, asOf);
      holdings += account.positions.length;
      valueCents += account.valueCents;
      accounts++;
    }
  }
  await Promise.all([
    logAudit(
      { type: "user", id: db.userId },
      "positions_imported",
      { type: "user", id: db.userId },
      { files: files.length, accounts, holdings },
    ),
    // The layout and count only: nothing from the file itself.
    ...read.map((file) =>
      track(db.userId, "upload_succeeded", {
        format: `positions_${file.layout}`,
        rows: file.accounts.reduce((n, a) => n + a.positions.length, 0),
      }),
    ),
  ]);
  return { ok: true, accounts, holdings, valueCents };
}

async function saveAccount(
  db: ScopedDb,
  account: ParsedPositionsAccount,
  // The type the person picked; none keeps an earlier upload's, else the file's guess.
  chosen: string | null,
  asOf: string,
) {
  const found = await db.accounts.findFirst({
    where: { source: "csv", type: "investment", name: account.name },
    select: { id: true, subtype: true },
  });
  const subtype = chosen ?? found?.subtype ?? account.subtype;
  const fields = { subtype, mask: account.mask, currentBalanceCents: account.valueCents };
  const accountId = found
    ? (await db.accounts.update({ where: { id: found.id }, data: fields, select: { id: true } })).id
    : (
        await db.accounts.create({
          data: {
            userId: db.userId,
            source: "csv",
            name: account.name,
            type: "investment",
            ...fields,
          },
          select: { id: true },
        })
      ).id;
  const date = dayOf(asOf);
  const rows = merged(account.positions);
  const securityIds = await Promise.all(
    rows.map(async ([ref, p]) => {
      const data = {
        name: p.name,
        ticker: p.ticker,
        type: p.type,
        isCashEquivalent: p.isCash,
        closePriceCents: p.priceCents,
        closePriceAsOf: date,
      };
      const saved = await db.securities.upsert({
        where: { userId_plaidSecurityId: { userId: db.userId, plaidSecurityId: ref } },
        create: { userId: db.userId, plaidSecurityId: ref, ...data },
        update: data,
        select: { id: true },
      });
      return saved.id;
    }),
  );
  await Promise.all(
    rows.map(([, p], i) => {
      const data = {
        quantity: p.quantity,
        priceCents: p.priceCents,
        priceAsOf: date,
        valueCents: p.valueCents,
        costBasisCents: p.costBasisCents,
      };
      return db.holdings.upsert({
        where: { accountId_securityId: { accountId, securityId: securityIds[i] } },
        create: { userId: db.userId, accountId, securityId: securityIds[i], ...data },
        update: data,
      });
    }),
  );
  // A newer download replaces the account's holdings: what it no longer lists is sold.
  await db.holdings.deleteMany({ where: { accountId, securityId: { notIn: securityIds } } });
  // The value on the download's day, for net worth's line.
  await db.balanceSnapshots.upsert({
    where: { accountId_date: { accountId, date } },
    create: {
      userId: db.userId,
      accountId,
      date,
      balanceCents: account.valueCents,
      source: "file",
    },
    update: { balanceCents: account.valueCents, source: "file" },
  });
}
