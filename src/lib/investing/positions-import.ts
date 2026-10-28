import { INVESTMENT_KINDS } from "@/data-sources/types";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db-scoped";
import { setUploadedBalance } from "@/lib/import/account-balance";
import { keepGivenBalance } from "@/lib/import/balances";
import {
  MAX_POSITIONS,
  parsePositionsCsv,
  type ParsedPositions,
  type Position,
} from "./positions-csv";

// A positions export saved as holdings (read-only beta): one investment account per account in the
// file, its holdings replaced by what the file says now, and its balance the total, so net worth
// counts it. The file is read in memory and never stored. Re-uploading the same account replaces
// its holdings rather than adding to them.

export const MAX_POSITION_BYTES = 1_000_000;

export type PositionsResult =
  | { ok: true; accounts: { name: string; holdings: number; valueCents: number }[]; jobId: string }
  | { ok: false; error: string };

const RETIREMENT = /\b(ira|401\(?k\)?|403\(?b\)?|roth|retirement|sep|rollover)\b/i;

function securityType(p: Position): string {
  if (p.isCash) return "cash";
  if (
    /\bETF\b|\bTRUST\b|ISHARES|SPDR|INDEX FUND ETF/i.test(p.name) ||
    /^(VTI|VOO|VXUS|BND|QQQ|SPY|IVV|SCHB|SCHX|SCHD|VT|AGG|IEFA|IEMG)$/.test(p.ticker)
  )
    return "etf";
  if (/^[A-Z]{4}X$/.test(p.ticker)) return "mutual fund";
  return "equity";
}

export async function savePositions(
  db: ScopedDb,
  parsed: ParsedPositions,
  now = new Date(),
): Promise<PositionsResult> {
  const total = parsed.accounts.reduce((n, a) => n + a.positions.length, 0);
  if (total === 0) return { ok: false, error: "Jane found no holdings in that file." };
  if (total > MAX_POSITIONS)
    return { ok: false, error: `That file has more than ${MAX_POSITIONS} holdings.` };
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const saved: { id: string; name: string; holdings: number; valueCents: number }[] = [];
  for (const account of parsed.accounts) {
    const name = [parsed.broker ?? "Brokerage", account.label === "Brokerage" ? "" : account.label]
      .join(" ")
      .trim();
    const existing = (
      await db.accounts.findMany({
        where: { source: "csv", type: "investment" },
        select: { id: true, name: true },
      })
    ).find((a) => a.name.toLowerCase() === name.toLowerCase());
    const kind = RETIREMENT.test(account.label) ? "retirement" : "investment_account";
    const id =
      existing?.id ??
      (
        await db.accounts.create({
          data: {
            userId: db.userId,
            source: "csv",
            name,
            type: INVESTMENT_KINDS[kind].type,
            subtype: INVESTMENT_KINDS[kind].subtype,
          },
          select: { id: true },
        })
      ).id;
    await db.holdings.deleteMany({ where: { accountId: id } });
    let valueCents = 0;
    for (const p of account.positions) {
      const security = await db.securities.upsert({
        where: {
          userId_plaidSecurityId: { userId: db.userId, plaidSecurityId: `csv:${p.ticker}` },
        },
        create: {
          userId: db.userId,
          plaidSecurityId: `csv:${p.ticker}`,
          name: p.name,
          ticker: p.isCash ? null : p.ticker,
          type: securityType(p),
          isCashEquivalent: p.isCash,
          closePriceCents: p.priceCents,
          closePriceAsOf: day,
        },
        update: { name: p.name, closePriceCents: p.priceCents, closePriceAsOf: day },
        select: { id: true },
      });
      await db.holdings.create({
        data: {
          userId: db.userId,
          accountId: id,
          securityId: security.id,
          quantity: p.quantity,
          priceCents: p.priceCents ?? 0,
          priceAsOf: day,
          valueCents: p.valueCents,
          costBasisCents: p.costBasisCents,
        },
      });
      valueCents += p.valueCents;
    }
    await db.accounts.updateMany({ where: { id }, data: { currentBalanceCents: valueCents } });
    await keepGivenBalance(db, id, valueCents);
    saved.push({ id, name, holdings: account.positions.length, valueCents });
  }
  const last = saved[saved.length - 1];
  const set = await setUploadedBalance(db, last.id, last.valueCents);
  await Promise.all([
    logAudit(
      { type: "user", id: db.userId },
      "positions_imported",
      { type: "user", id: db.userId },
      {
        accounts: saved.length,
        holdings: total,
        broker: parsed.broker ?? "unknown",
      },
    ),
    track(db.userId, "positions_imported", { accounts: saved.length, holdings: total }),
  ]);
  return {
    ok: true,
    accounts: saved.map(({ name, holdings, valueCents }) => ({ name, holdings, valueCents })),
    jobId: set?.jobId ?? "",
  };
}

// The text of an uploaded file, read as positions or refused with a plain reason.
export async function importPositionsText(
  db: ScopedDb,
  text: string,
  now = new Date(),
): Promise<PositionsResult> {
  const parsed = parsePositionsCsv(text);
  if (!parsed) {
    return {
      ok: false,
      error:
        "That doesn't look like a positions file. Download the positions (holdings) list from Fidelity, Schwab, Vanguard or Robinhood, not the transactions.",
    };
  }
  return savePositions(db, parsed, now);
}
