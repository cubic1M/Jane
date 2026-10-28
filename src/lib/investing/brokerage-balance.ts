import { INVESTMENT_KINDS } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";
import { setUploadedBalance } from "@/lib/import/account-balance";
import { isInvestingApp, summarize, type AppSummary } from "./apps";

// "What's in your Robinhood account today?" (read-only beta): when a person's rows show money sent
// to an investing app or a brokerage, Jane asks what is in it, the way an upload without a
// balance asks what is owed (src/lib/import/account-balance.ts). The answer becomes a typed-balance
// investment account, counted in net worth, with nothing about what it holds.

export const WINDOW_DAYS = 92;
const DAY_MS = 86_400_000;
const TRANSFER = "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const sameApp = (accountName: string, app: string) =>
  accountName.toLowerCase().includes(app.toLowerCase());

export type BrokerageAsks = {
  // Apps money went to, with no account of that name that has a balance yet.
  asks: AppSummary[];
  // Everything sent to investing apps in the last three months, all apps together.
  inLast3MonthsCents: number;
};

export async function brokerageAsks(
  db: Pick<ScopedDb, "transactions" | "accounts">,
  now = new Date(),
): Promise<BrokerageAsks> {
  const from = iso(new Date(now.getTime() - WINDOW_DAYS * DAY_MS));
  const [rows, accounts] = await Promise.all([
    db.transactions.findMany({
      where: { pfcDetailed: TRANSFER, date: { gte: new Date(`${from}T00:00:00Z`) } },
      select: { date: true, amountCents: true, description: true },
    }),
    db.accounts.findMany({
      where: { type: "investment" },
      select: { name: true, currentBalanceCents: true },
    }),
  ]);
  const summary = summarize(
    rows.map((r) => ({
      date: iso(r.date),
      amountCents: r.amountCents,
      description: r.description,
    })),
    from,
    iso(now),
  );
  return {
    asks: summary.filter(
      (s) => !accounts.some((a) => a.currentBalanceCents !== null && sameApp(a.name, s.app)),
    ),
    inLast3MonthsCents: summary.reduce((sum, s) => sum + s.inCents, 0),
  };
}

// The balance in one investing app, from the person. The account is made if there isn't one of
// that name (an upload-only person has none), and the numbers are worked out again in the
// background like any typed balance. Null when the app isn't one Jane knows.
export async function setBrokerageBalance(
  db: Pick<ScopedDb, "userId" | "accounts" | "importRuns" | "balanceSnapshots">,
  app: string,
  cents: number,
): Promise<{ jobId: string } | null> {
  if (!isInvestingApp(app) || !Number.isInteger(cents) || cents < 0) return null;
  const existing = await db.accounts.findMany({
    where: { type: "investment", source: "csv" },
    select: { id: true, name: true },
  });
  const found = existing.find((a) => sameApp(a.name, app));
  const id =
    found?.id ??
    (
      await db.accounts.create({
        data: {
          userId: db.userId,
          source: "csv",
          name: app,
          type: INVESTMENT_KINDS.investment_account.type,
          subtype: INVESTMENT_KINDS.investment_account.subtype,
        },
        select: { id: true },
      })
    ).id;
  return setUploadedBalance(db, id, cents);
}
