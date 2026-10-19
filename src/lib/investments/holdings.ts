import { INVESTMENT_MONTHS } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  investmentSummary,
  monthlyInvestments,
  type InvestmentSummary,
} from "@/insights/investments";
import { monthsEnding } from "@/insights/spending";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// What the person owns (spec step 128), loaded once for the investments page, Jane's
// answers and her tools, all scoped to the person. Every later investment step starts
// from this.

export type Investments = InvestmentSummary & {
  asOf: string;
  months: ReturnType<typeof monthlyInvestments>;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function loadInvestments(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<Investments> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const [first] = monthsEnding(asOf, INVESTMENT_MONTHS);
  const [accounts, securities, holdings] = await Promise.all([
    db.accounts.findMany({
      where: { type: "investment" },
      select: {
        id: true,
        name: true,
        subtype: true,
        currentBalanceCents: true,
        item: { select: { institutionName: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.securities.findMany({
      select: { id: true, name: true, ticker: true, type: true, isCashEquivalent: true },
    }),
    db.holdings.findMany({
      select: {
        id: true,
        accountId: true,
        securityId: true,
        quantity: true,
        priceCents: true,
        priceAsOf: true,
        valueCents: true,
        costBasisCents: true,
      },
    }),
  ]);
  const snapshots =
    accounts.length === 0
      ? []
      : await db.balanceSnapshots.findMany({
          where: {
            accountId: { in: accounts.map((a) => a.id) },
            date: { gte: new Date(`${first}-01T00:00:00Z`) },
          },
          select: { accountId: true, date: true, balanceCents: true },
        });
  const rows = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    subtype: a.subtype,
    balanceCents: a.currentBalanceCents,
    institution: a.item?.institutionName ?? null,
  }));
  return {
    asOf,
    ...investmentSummary(
      rows,
      securities,
      holdings.map((h) => ({ ...h, priceAsOf: iso(h.priceAsOf) })),
    ),
    months: monthlyInvestments(
      rows,
      snapshots.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
      asOf,
      INVESTMENT_MONTHS,
    ),
  };
}

// For Download my data: what the person owns and its history, as stored.
export async function investmentsExport(userId: string, client: PrismaClient = defaultClient) {
  const db = scopedFor(userId, client);
  const [securities, holdings, transactions] = await Promise.all([
    db.securities.findMany({
      select: {
        id: true,
        name: true,
        ticker: true,
        type: true,
        subtype: true,
        isCashEquivalent: true,
        closePriceCents: true,
        closePriceAsOf: true,
        sector: true,
      },
      orderBy: { name: "asc" },
    }),
    db.holdings.findMany({
      select: {
        accountId: true,
        securityId: true,
        quantity: true,
        priceCents: true,
        priceAsOf: true,
        valueCents: true,
        costBasisCents: true,
        updatedAt: true,
      },
      orderBy: [{ accountId: "asc" }, { securityId: "asc" }],
    }),
    db.investmentTransactions.findMany({
      select: {
        accountId: true,
        securityId: true,
        date: true,
        name: true,
        quantity: true,
        amountCents: true,
        priceCents: true,
        feesCents: true,
        type: true,
        subtype: true,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
  ]);
  // Spec step 129: their answers about what the money is for.
  const profile = await db.investorProfiles.findFirst({
    select: {
      age: true,
      ageOn: true,
      horizon: true,
      dropReaction: true,
      goals: true,
      answeredAt: true,
      updatedAt: true,
    },
  });
  // Spec step 133: orders through the brokerage partner, with confirmations.
  const orders = await db.brokerageOrders.findMany({
    select: {
      accountId: true,
      reason: true,
      partner: true,
      ticker: true,
      securityName: true,
      side: true,
      amountCents: true,
      quantity: true,
      priceCents: true,
      status: true,
      confirmation: true,
      placedAt: true,
      filledAt: true,
    },
    orderBy: { placedAt: "asc" },
  });
  // Spec step 158: college savings plans.
  const collegePlans = await db.collegePlans.findMany({
    select: {
      childName: true,
      childAge: true,
      ageOn: true,
      collegeType: true,
      planKey: true,
      createdAt: true,
    },
  });
  // Spec step 159: the HSA receipts vault.
  const hsaReceipts = await db.hsaReceipts.findMany({
    select: {
      transactionId: true,
      date: true,
      merchant: true,
      amountCents: true,
      status: true,
      reimbursedAt: true,
    },
  });
  return { securities, holdings, transactions, profile, orders, collegePlans, hsaReceipts };
}
