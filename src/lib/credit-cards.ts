import { CARD_PARTNER, CARD_SPEND_DAYS, CARD_SPEND_MIN_DAYS } from "@/config/credit-cards";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { demoCreditCards } from "@/lib/credit-cards/demo";
import type { CreditCardPartner, CardProduct } from "@/lib/credit-cards/partner";
import { creditBandFor } from "@/lib/credit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { autopilotFor } from "@/lib/sector-autopilot";
import {
  betterCards,
  earnsCents,
  feeCheck,
  wallet,
  yearSpend,
  type BetterCard,
  type FeeCheck,
  type Wallet,
  type YearSpend,
} from "@/planning/credit-cards";
import { DAY_MS, isoDay } from "@/lib/dates";

// The right card for each purchase (spec step 174). Jane works out, from the person's own
// year of spending, what each of their cards earns with its fee taken off, which card to
// use for each kind of spending, whether each annual fee pays for itself, and whether a
// card from the partner's catalog would earn more; the person applies with one tap. Only
// the stand-in catalog exists, so only demo-bank people get this, always labelled as demo
// advice; nothing is applied for without a tap.

type Options = { client?: PrismaClient; now?: Date };

export class CreditCardError extends Error {}

export async function creditCardPartnerFor(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ key: string; partner: CreditCardPartner } | null> {
  if (CARD_PARTNER !== "demo") return null;
  return (await adviceMode(userId, { client })) ? { key: "demo", partner: demoCreditCards } : null;
}

export type OwnCard = {
  accountId: string | null;
  // The card's name at the bank, or the new card's name.
  name: string;
  product: CardProduct | null;
  // What it would earn on all of the person's spending, with its fee taken off.
  earnsCents: number | null;
  fee: FeeCheck | null;
  // A card applied for through Jane, approved but not linked yet.
  fromApplication: boolean;
};

export type CardApplicationView = {
  id: string;
  productId: string;
  issuer: string;
  cardName: string;
  status: string;
  createdOn: string;
};

export type CreditCards = {
  available: boolean;
  asOf: string;
  cards: OwnCard[];
  spend: YearSpend;
  // Fewer than CARD_SPEND_MIN_DAYS of history: a first look.
  firstLook: boolean;
  // The person's identified cards used at their best for each kind of spending.
  wallet: Wallet;
  // At most three, the best first.
  better: BetterCard[];
  // The debt autopilot level: from "Handle the safe stuff" Jane keeps the card for each
  // kind of spending up to date in the chat on its own.
  level: "ask" | "safe" | "all";
  applications: CardApplicationView[];
};

const empty = (asOf: string): CreditCards => ({
  available: false,
  asOf,
  cards: [],
  spend: {
    byCategory: { dining: 0, groceries: 0, gas: 0, travel: 0, streaming: 0, online: 0, other: 0 },
    totalCents: 0,
    days: 0,
  },
  firstLook: true,
  wallet: { picks: [], earnsCents: 0, feesCents: 0, netCents: 0 },
  better: [],
  level: "ask",
  applications: [],
});

export async function loadCreditCards(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options & { book?: DebtBook } = {},
): Promise<CreditCards> {
  const asOf = isoDay(now);
  const found = await creditCardPartnerFor(userId, { client });
  if (!found) return empty(asOf);
  const db = scopedFor(userId, client);
  const [book, transactions, apps, creditBand, setting] = await Promise.all([
    debtsOr(given, userId, { client, now }),
    db.transactions.findMany({
      where: { date: { gte: new Date(now.getTime() - (CARD_SPEND_DAYS + 1) * DAY_MS) } },
      select: {
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcPrimary: true,
        pfcDetailed: true,
        pending: true,
      },
    }),
    db.cardApplications.findMany({
      select: {
        id: true,
        productId: true,
        issuer: true,
        cardName: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    creditBandFor(userId, { client }),
    autopilotFor(userId, "debt", { client, now }),
  ]);
  const spend = yearSpend(
    transactions.map((t) => ({ ...t, date: isoDay(t.date) })),
    asOf,
  );
  const catalog = await found.partner.catalog({ creditBand, month: asOf.slice(0, 7) });
  const cardDebts = book.debts.filter((d) => d.kind === "card" && d.accountId);
  // Identified by the account's own name at the bank (the debt's name adds its mask).
  const accounts = await db.accounts.findMany({
    where: { id: { in: cardDebts.map((d) => d.accountId!) } },
    select: { id: true, name: true },
  });
  const own: OwnCard[] = [];
  for (const debt of cardDebts) {
    const bankName = accounts.find((a) => a.id === debt.accountId)?.name ?? debt.name;
    const product = await found.partner.identify(bankName);
    own.push({
      accountId: debt.accountId,
      name: debt.name,
      product,
      earnsCents: product ? earnsCents(product, spend.byCategory) - product.annualFeeCents : null,
      fee: product ? feeCheck(product, spend.byCategory, catalog) : null,
      fromApplication: false,
    });
  }
  // Spec step 174: a card approved through Jane counts as theirs before it's linked.
  for (const app of apps.filter((a) => a.status === "approved")) {
    if (own.some((c) => c.product?.id === app.productId)) continue;
    const product = await found.partner.product(app.productId);
    if (!product) continue;
    own.push({
      accountId: null,
      name: product.name,
      product,
      earnsCents: earnsCents(product, spend.byCategory) - product.annualFeeCents,
      fee: feeCheck(product, spend.byCategory, catalog),
      fromApplication: true,
    });
  }
  const products = own.flatMap((c) => (c.product ? [c.product] : []));
  // Nothing new while an application is waiting on the issuer.
  const pending = apps.some((a) => a.status === "pending");
  const current = wallet(products, spend.byCategory);
  return {
    available: true,
    asOf,
    cards: own,
    spend,
    firstLook: spend.days < CARD_SPEND_MIN_DAYS,
    wallet: current,
    better: pending
      ? []
      : betterCards(products, catalog, spend.byCategory, spend.totalCents).slice(0, 3),
    level: setting.level,
    applications: apps.map((a) => ({
      id: a.id,
      productId: a.productId,
      issuer: a.issuer,
      cardName: a.cardName,
      status: a.status,
      createdOn: isoDay(a.createdAt),
    })),
  };
}

// The person tapped Apply: a real application with the issuer, with a hard credit check.
// Only a card from this month's catalog for them, and never twice.
export async function applyForCard(
  userId: string,
  productId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CardApplicationView> {
  const found = await creditCardPartnerFor(userId, { client });
  if (!found)
    throw new CreditCardError("Card applications aren't available for your accounts yet.");
  const creditBand = await creditBandFor(userId, { client });
  const catalog = await found.partner.catalog({
    creditBand,
    month: isoDay(now).slice(0, 7),
  });
  const product = catalog.find((c) => c.id === productId);
  if (!product) throw new CreditCardError("That card isn't offered to you right now.");
  const db = scopedFor(userId, client);
  const already = await db.cardApplications.findFirst({
    where: { productId, status: { in: ["pending", "approved"] } },
    select: { id: true },
  });
  if (already) throw new CreditCardError(`You've already applied for the ${product.name}.`);
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const result = await found.partner.apply({
    product,
    creditBand,
    applicant: { name: user?.name ?? "", email: user?.email ?? "" },
  });
  const row = await db.cardApplications.create({
    data: {
      userId,
      partner: found.key,
      productId: product.id,
      issuer: product.issuer,
      cardName: product.name,
      annualFeeCents: product.annualFeeCents,
      status: result.status,
      partnerApplicationId: result.applicationId,
      createdAt: now,
    },
    select: {
      id: true,
      productId: true,
      issuer: true,
      cardName: true,
      status: true,
      createdAt: true,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "card_application_submitted",
    { type: "card_application", id: row.id },
    { issuer: product.issuer, card: product.name, status: result.status },
  );
  await track(userId, "card_application_submitted", { card: product.id, status: result.status });
  return {
    id: row.id,
    productId: row.productId,
    issuer: row.issuer,
    cardName: row.cardName,
    status: row.status,
    createdOn: isoDay(row.createdAt),
  };
}
