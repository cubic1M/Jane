import { randomUUID } from "node:crypto";
import {
  HSA_FUND,
  HSA_NOT_QUALIFIED,
  HSA_RECEIPT_LOOKBACK_DAYS,
  HSA_RECEIPT_PRIMARY,
} from "@/config/hsa";
import { FUND_NAMES } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDemoExtra } from "@/lib/plaid/demo";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { currentAge } from "@/planning/investor-profile";
import { hsaPlan, type HsaPlan } from "@/planning/hsa";
import { loadInvestments } from "./holdings";
import { profileOf } from "./profile";
import { DAY_MS, isoDay as iso } from "@/lib/dates";

// The HSA as an investment (spec step 159), for its page, Jane's answers, its buttons and
// the nightly run. Advice (what to invest) in demo advice mode only; the receipts vault is
// a record, kept for everyone.

type Options = { client?: PrismaClient; now?: Date };

export class HsaError extends Error {}

// Medical charges in the person's transactions become saved receipts, once each. Jane does
// this on its own at every level: it only keeps a record.
export async function collectReceipts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const charges = await db.transactions.findMany({
    where: {
      pfcPrimary: HSA_RECEIPT_PRIMARY,
      pfcDetailed: { notIn: [...HSA_NOT_QUALIFIED] },
      amountCents: { gt: 0 },
      pending: false,
      date: { gte: new Date(now.getTime() - HSA_RECEIPT_LOOKBACK_DAYS * DAY_MS) },
      hsaReceipt: { is: null },
    },
    select: { id: true, amountCents: true, date: true, merchantName: true, description: true },
  });
  if (charges.length === 0) return 0;
  // Two runs at once (a page and the brain) can find the same charge: each is saved once.
  const { count } = await db.hsaReceipts.createMany({
    data: charges.map((t) => ({
      userId,
      transactionId: t.id,
      amountCents: t.amountCents,
      date: t.date,
      merchant: t.merchantName ?? t.description,
    })),
    skipDuplicates: true,
  });
  return count;
}

export async function collectAllReceipts({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  // A system job: owners of medical charges in the last year, each collected scoped.
  const owners = await client.transaction.findMany({
    where: {
      pfcPrimary: HSA_RECEIPT_PRIMARY,
      hsaReceipt: { is: null },
      date: { gte: new Date(now.getTime() - HSA_RECEIPT_LOOKBACK_DAYS * DAY_MS) },
      user: { deletedAt: null },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  let saved = 0;
  for (const { userId } of owners) saved += await collectReceipts(userId, { client, now });
  return { people: owners.length, saved };
}

export type HsaView = {
  advice: boolean;
  account: { id: string; name: string; balanceCents: number } | null;
  plan: HsaPlan | null;
  coverage: "self" | "family";
  receipts: {
    id: string;
    transactionId: string;
    date: string;
    merchant: string;
    amountCents: number;
    status: string;
  }[];
  savedCents: number;
  demo: boolean;
};

export async function loadHsa(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<HsaView> {
  const db = scopedFor(userId, client);
  const [advice, investments, tax, answers, receipts, demoItem] = await Promise.all([
    adviceMode(userId, { client }),
    loadInvestments(userId, { client, now }),
    loadWorkingProfile(userId, { client }),
    profileOf(userId, { client }),
    db.hsaReceipts.findMany({
      select: {
        id: true,
        transactionId: true,
        date: true,
        merchant: true,
        amountCents: true,
        status: true,
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
    }),
    db.plaidItems.findFirst({
      where: { plaidItemId: { startsWith: "demo-" } },
      select: { id: true },
    }),
  ]);
  const hsa = investments.accounts.find((a) => (a.subtype ?? "").toLowerCase() === "hsa") ?? null;
  // Family coverage when they file jointly or have children; otherwise self-only.
  const coverage =
    tax.profile.filingStatus === "married_joint" || tax.profile.childrenUnder17 > 0
      ? "family"
      : "self";
  let plan: HsaPlan | null = null;
  if (hsa) {
    const contributions = await db.investmentTransactions.findMany({
      where: {
        accountId: hsa.id,
        subtype: "contribution",
        date: { gt: new Date(now.getTime() - 365 * DAY_MS), lte: now },
      },
      select: { amountCents: true },
    });
    plan = hsaPlan({
      balanceCents: hsa.balanceCents ?? 0,
      cashCents: hsa.holdings.filter((h) => h.isCash).reduce((s, h) => s + h.valueCents, 0),
      contributedCents: contributions.reduce((s, c) => s - c.amountCents, 0),
      coverage,
      age: currentAge(answers, iso(now)),
    });
  }
  const mapped = receipts.map((r) => ({ ...r, date: iso(r.date) }));
  return {
    advice,
    account: hsa ? { id: hsa.id, name: hsa.name, balanceCents: hsa.balanceCents ?? 0 } : null,
    plan,
    coverage,
    receipts: mapped,
    savedCents: mapped.filter((r) => r.status === "saved").reduce((s, r) => s + r.amountCents, 0),
    demo: demoItem !== null,
  };
}

// The stand-in HSA for a demo-bank person.
export async function linkDemoHsa(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const itemId = await addDemoExtra(userId, "hsa", { client });
  if (!itemId) throw new HsaError("A demo HSA needs the demo bank.");
  await syncDemoInvestments(itemId, { client, now });
  await track(userId, "demo_hsa_linked", {});
}

// One tap: the HSA's cash beyond the cushion, invested through the brokerage partner.
export async function investHsaCash(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadHsa(userId, { client, now });
  if (!view.advice) throw new HsaError("Investing an HSA is only in demo advice mode for now.");
  if (!view.account || !view.plan) throw new HsaError("There's no HSA linked.");
  if (view.plan.toInvestCents <= 0)
    throw new HsaError("Your HSA cash is within its cushion: nothing to invest.");
  const partner = brokeragePartner();
  const batchId = randomUUID();
  const [confirmation] = await partner.placeOrders(
    userId,
    {
      batchId,
      reason: "hsa_invest",
      orders: [
        {
          accountId: view.account.id,
          ticker: HSA_FUND,
          securityName: FUND_NAMES[HSA_FUND] ?? HSA_FUND,
          side: "buy",
          amountCents: view.plan.toInvestCents,
        },
      ],
    },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "brokerage_orders_placed",
    { type: "brokerage_batch", id: batchId },
    { reason: "hsa_invest", orders: 1, simulated: partner.simulated },
  );
  const item = await scopedFor(userId, client).accounts.findFirst({
    where: { id: view.account.id },
    select: { itemId: true },
  });
  if (item?.itemId) await syncDemoInvestments(item.itemId, { client, now });
  return { amountCents: view.plan.toInvestCents, confirmation };
}

export async function markReimbursed(
  userId: string,
  receiptId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const { count } = await scopedFor(userId, client).hsaReceipts.updateMany({
    where: { id: receiptId, status: "saved" },
    data: { status: "reimbursed", reimbursedAt: now },
  });
  if (count === 0)
    throw new HsaError("That receipt isn't in your vault, or it's already paid back.");
}
