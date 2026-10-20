import {
  CANDIDATE_LOOKBACK_DAYS,
  COSIGNED_PAST_DUE_DAYS,
  PAYMENT_APPS,
  REMIND_AFTER_DAYS,
  REMIND_AGAIN_DAYS,
} from "@/config/family-loans";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Debt, DebtBook } from "@/insights/debts";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { householdOf } from "@/lib/household";
import { HALF_BPS } from "@/lib/shared-bills";
import {
  candidatesFrom,
  loanBalance,
  nameKey,
  parseTransfer,
  reminderText,
  type Candidate,
  type Transfer,
} from "@/planning/family-loans";

// Money between family and friends (spec step 226). Jane spots payment-app transfers (Venmo,
// Zelle, Cash App) that might be a loan and asks once; a transfer is a loan only after the
// person says so. Repayments are matched from the transfers that come back, a gentle
// reminder is drafted for the person to send themselves (Jane never messages the other
// person), co-signed loans are watched for missed payments, and the household's shared debts
// show each person's share.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export class FamilyLoanError extends Error {}

export type FamilyLoan = {
  id: string;
  kind: "lent" | "borrowed";
  counterparty: string;
  principalCents: number;
  balanceCents: number;
  openedOn: string;
  note: string | null;
  repaid: { date: string; cents: number }[];
  daysOpen: number;
  // The reminder draft once the loan has been open REMIND_AFTER_DAYS, and which one it is.
  reminder: { text: string; round: number } | null;
};

export type CosignedLoan = {
  id: string;
  counterparty: string;
  debtKey: string;
  debtName: string;
  missed: boolean;
  pastDueCents: number | null;
  nextDue: string | null;
  text: string | null;
};

export type SharedDebt = {
  debtKey: string;
  name: string;
  balanceCents: number | null;
  paymentCents: number | null;
  yourShareCents: number | null;
  partnerShareCents: number | null;
};

export type FamilyLoans = {
  asOf: string;
  candidates: Candidate[];
  loans: FamilyLoan[];
  settled: {
    id: string;
    kind: string;
    counterparty: string;
    principalCents: number;
    settledOn: string | null;
  }[];
  cosigned: CosignedLoan[];
  shared: SharedDebt[];
  // The debts the person could mark as co-signed.
  cosignable: { debtKey: string; name: string }[];
  inHousehold: boolean;
};

export async function loadFamilyLoans(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options = {},
): Promise<FamilyLoans> {
  const asOf = isoDay(now);
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - CANDIDATE_LOOKBACK_DAYS * DAY_MS);
  const rows = await db.personalLoans.findMany({ orderBy: { openedOn: "desc" } });
  const earliest = rows.reduce((min, r) => (r.openedOn < min ? r.openedOn : min), since);
  const [book, txs, sharedAccounts, household] = await Promise.all([
    debtsOr(given, userId, { client, now }),
    db.transactions.findMany({
      where: {
        date: { gte: earliest < since ? earliest : since },
        pending: false,
        OR: PAYMENT_APPS.map((a) => ({
          description: { contains: a, mode: "insensitive" as const },
        })),
      },
      select: { id: true, date: true, amountCents: true, description: true, merchantName: true },
      orderBy: { date: "desc" },
    }),
    db.accounts.findMany({ where: { sharedWithHousehold: true }, select: { id: true } }),
    householdOf(userId, { client }),
  ]);
  const transfers: Transfer[] = txs.map((t) => ({ ...t, date: isoDay(t.date) }));
  const taken = new Set(rows.map((r) => r.sourceKey));
  const known = rows
    .filter((r) => r.status !== "dismissed" && r.kind !== "cosigned")
    .map((r) => ({ counterpartyKey: nameKey(r.counterparty), kind: r.kind }));
  const candidates = candidatesFrom(
    transfers.filter((t) => t.date >= isoDay(since)),
    known,
  ).filter((c) => !taken.has(c.id));

  const loans: FamilyLoan[] = [];
  for (const r of rows.filter((x) => x.status === "open" && x.kind !== "cosigned")) {
    const openedOn = isoDay(r.openedOn);
    const { balanceCents, repaid } = loanBalance(
      {
        kind: r.kind === "borrowed" ? "borrowed" : "lent",
        counterpartyKey: nameKey(r.counterparty),
        principalCents: r.principalCents,
        openedOn,
      },
      transfers,
    );
    const daysOpen = Math.round(
      (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${openedOn}T00:00:00Z`)) / DAY_MS,
    );
    const round =
      daysOpen >= REMIND_AFTER_DAYS
        ? Math.floor((daysOpen - REMIND_AFTER_DAYS) / REMIND_AGAIN_DAYS)
        : -1;
    const app =
      parseTransfer(
        transfers.find((t) => `tx:${t.id}` === r.sourceKey) ?? { amountCents: 0, description: "" },
      )?.app ?? null;
    loans.push({
      id: r.id,
      kind: r.kind === "borrowed" ? "borrowed" : "lent",
      counterparty: r.counterparty,
      principalCents: r.principalCents,
      balanceCents,
      openedOn,
      note: r.note,
      repaid,
      daysOpen,
      reminder:
        r.kind === "lent" && balanceCents > 0 && round >= 0
          ? {
              round,
              text: reminderText({
                counterparty: r.counterparty,
                balanceCents,
                principalCents: r.principalCents,
                openedOn,
                app,
              }),
            }
          : null,
    });
  }

  const cosigned: CosignedLoan[] = [];
  for (const r of rows.filter((x) => x.status === "open" && x.kind === "cosigned")) {
    const debt = book.debts.find((d) => d.key === r.sourceKey);
    if (!debt) continue;
    const missed =
      debt.overdue ||
      (debt.pastDueCents !== null && debt.pastDueCents > 0) ||
      (debt.nextDue !== null && daysBefore(asOf, debt.nextDue) >= COSIGNED_PAST_DUE_DAYS);
    cosigned.push({
      id: r.id,
      counterparty: r.counterparty,
      debtKey: debt.key,
      debtName: debt.name,
      missed,
      pastDueCents: debt.pastDueCents,
      nextDue: debt.nextDue,
      text: missed
        ? `Hi ${r.counterparty.split(" ")[0]}, I noticed a payment on the ${debt.name} loan we're both on looks late. Could we check it today so neither of our credit takes a hit? Happy to help sort it out.`
        : null,
    });
  }

  const sharedIds = new Set(sharedAccounts.map((a) => a.id));
  const shared: SharedDebt[] = book.debts
    .filter((d) => d.accountId && sharedIds.has(d.accountId) && d.kind !== "bnpl")
    .map((d) => ({
      debtKey: d.key,
      name: d.name,
      balanceCents: d.balanceCents,
      paymentCents: d.paymentCents,
      yourShareCents:
        d.paymentCents === null
          ? null
          : Math.round((d.paymentCents * (10_000 - HALF_BPS)) / 10_000),
      partnerShareCents:
        d.paymentCents === null ? null : Math.round((d.paymentCents * HALF_BPS) / 10_000),
    }));
  const used = new Set(
    rows.filter((r) => r.kind === "cosigned" && r.status === "open").map((r) => r.sourceKey),
  );
  return {
    asOf,
    candidates,
    loans,
    settled: rows
      .filter((r) => r.status === "settled")
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        counterparty: r.counterparty,
        principalCents: r.principalCents,
        settledOn: r.settledOn ? isoDay(r.settledOn) : null,
      })),
    cosigned,
    shared,
    cosignable: book.debts
      .filter((d: Debt) => d.accountId && d.kind !== "bnpl" && !used.has(d.key))
      .map((d) => ({ debtKey: d.key, name: d.name })),
    inHousehold: household !== null,
  };
}

const daysBefore = (asOf: string, day: string) =>
  Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);

// The person said a transfer was a loan.
export async function confirmFamilyLoan(
  userId: string,
  candidateId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ counterparty: string; kind: "lent" | "borrowed"; cents: number }> {
  const data = await loadFamilyLoans(userId, { client, now });
  const c = data.candidates.find((x) => x.id === candidateId);
  if (!c) throw new FamilyLoanError("That transfer isn't waiting for an answer any more.");
  const cents = Math.abs(c.transfer.amountCents);
  const row = await scopedFor(userId, client).personalLoans.create({
    data: {
      userId,
      kind: c.kind,
      counterparty: c.parsed.counterparty,
      principalCents: cents,
      openedOn: new Date(`${c.transfer.date}T00:00:00Z`),
      sourceKey: c.id,
      note: c.parsed.note,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "personal_loan_confirmed",
    { type: "personal_loan", id: row.id },
    { kind: c.kind },
  );
  await track(userId, "personal_loan_confirmed", { kind: c.kind });
  return { counterparty: c.parsed.counterparty, kind: c.kind, cents };
}

// The person said it isn't a loan: not asked about again.
export async function dismissFamilyLoan(
  userId: string,
  candidateId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const data = await loadFamilyLoans(userId, { client, now });
  const c = data.candidates.find((x) => x.id === candidateId);
  if (!c) throw new FamilyLoanError("That transfer isn't waiting for an answer any more.");
  await scopedFor(userId, client).personalLoans.create({
    data: {
      userId,
      kind: c.kind,
      counterparty: c.parsed.counterparty,
      principalCents: Math.abs(c.transfer.amountCents),
      openedOn: new Date(`${c.transfer.date}T00:00:00Z`),
      sourceKey: c.id,
      status: "dismissed",
    },
  });
}

// The person marked a loan as settled by hand.
export async function settleFamilyLoan(
  userId: string,
  loanId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).personalLoans.updateMany({
    where: { id: loanId, status: "open" },
    data: { status: "settled", settledOn: new Date(`${isoDay(now)}T00:00:00Z`) },
  });
  if (count === 0) throw new FamilyLoanError("That loan isn't open.");
}

// One of the person's own debts, co-signed for someone else.
export async function addCosignedLoan(
  userId: string,
  form: { debtKey: string; counterparty: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const data = await loadFamilyLoans(userId, { client, now });
  const debt = data.cosignable.find((d) => d.debtKey === form.debtKey);
  if (!debt) throw new FamilyLoanError("Pick one of your loans.");
  const counterparty = form.counterparty.trim().slice(0, 80);
  if (!counterparty) throw new FamilyLoanError("Who did you co-sign for?");
  await scopedFor(userId, client).personalLoans.create({
    data: {
      userId,
      kind: "cosigned",
      counterparty,
      principalCents: 0,
      openedOn: new Date(`${isoDay(now)}T00:00:00Z`),
      sourceKey: debt.debtKey,
    },
  });
  await track(userId, "cosigned_loan_added");
}

// Jane's own step: loans paid back in full by the transfers that came back are settled.
export async function refreshFamilyLoans(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const data = await loadFamilyLoans(userId, { client, now });
  let settled = 0;
  for (const l of data.loans) {
    if (l.balanceCents > 0) continue;
    await scopedFor(userId, client).personalLoans.updateMany({
      where: { id: l.id, status: "open" },
      data: { status: "settled", settledOn: new Date(`${data.asOf}T00:00:00Z`) },
    });
    settled += 1;
  }
  return settled;
}
