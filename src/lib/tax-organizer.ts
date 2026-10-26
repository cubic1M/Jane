import { cache } from "react";
import { INCOME_KINDS, UNTAGGED, isTaxTagKind, type TaxTagKind } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadEquityIncome } from "@/lib/equity-income";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { expectedForms, type ExpectedForm } from "@/planning/tax-documents";
import {
  merchantKeyOf,
  tagAll,
  tagChecks,
  tagTotals,
  type TagCheck,
  type TagOverrides,
  type TagTotals,
  type Tagged,
} from "@/planning/tax-tags";
import { cachedCopy } from "@/lib/read-cache";

// The tax organizer (spec step 119): the year's tax tags and the forms to expect, loaded
// from the person's own transactions and loans; their own tags and "I have it" saved here.
// Always through scopedFor.

type Options = { client?: PrismaClient; now?: Date };

export class TaxOrganizerError extends Error {}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const yearRange = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lt: new Date(Date.UTC(year + 1, 0, 1)),
});

export async function loadOverrides(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<TagOverrides> {
  return client === defaultClient
    ? overridesOnce(userId)
    : cachedCopy(`taxOverrides:${userId}`, client, () => overridesFrom(userId, client));
}

// Read once per server render (React's cache): /taxes's sections each ask (31 times).
const overridesOnce = cache((userId: string) => overridesFrom(userId, defaultClient));

async function overridesFrom(userId: string, client: PrismaClient): Promise<TagOverrides> {
  const db = scopedFor(userId, client);
  const since = new Date(Date.now() - 400 * 86_400_000);
  const [rows, profile, freelance] = await Promise.all([
    db.taxTags.findMany({ select: { transactionId: true, merchantKey: true, tag: true } }),
    db.taxProfiles.findFirst({ select: { incomeKinds: true, answered: true } }),
    db.transactions.count({
      where: {
        amountCents: { lt: 0 },
        pfcDetailed: { in: [...INCOME_KINDS.self_employed.categories] },
        date: { gte: since },
      },
    }),
  ]);
  // Freelance income on their profile, or seen in the last year (unless they said no).
  const answeredIncome = profile?.answered.includes("incomeKinds") ?? false;
  const businessHints = answeredIncome
    ? (profile?.incomeKinds.includes("self_employed") ?? false)
    : freelance > 0;
  return {
    businessHints,
    byTransaction: new Map(
      rows.flatMap((r) => (r.transactionId ? [[r.transactionId, r.tag]] : [])),
    ),
    byMerchant: new Map(rows.flatMap((r) => (r.merchantKey ? [[r.merchantKey, r.tag]] : []))),
  };
}

export type TaxTagsView = {
  year: number;
  tagged: Tagged[];
  totals: TagTotals;
  // Merchants Jane is unsure about.
  checks: TagCheck[];
};

// Every tagged transaction of the year, money out only, posted only.
export async function loadTaxTags(
  userId: string,
  year: number,
  { client = defaultClient }: Options = {},
): Promise<TaxTagsView> {
  const db = scopedFor(userId, client);
  const [transactions, overrides] = await Promise.all([
    db.transactions.findMany({
      where: { pending: false, amountCents: { gt: 0 }, date: yearRange(year) },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
      // In a fixed order, so the tags and their totals always come out the same way.
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    loadOverrides(userId, { client }),
  ]);
  const tagged = tagAll(
    transactions.map((t) => ({ ...t, date: iso(t.date) })),
    overrides,
  );
  return { year, tagged, totals: tagTotals(tagged), checks: tagChecks(tagged) };
}

// The year's money out matching a search, for tagging by hand on /taxes/tags.
export async function searchToTag(
  userId: string,
  year: number,
  query: string,
  { client = defaultClient, limit }: Options & { limit: number },
) {
  const q = query.trim().slice(0, 60);
  if (!q) return [];
  const db = scopedFor(userId, client);
  const [rows, overrides] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { gt: 0 },
        date: yearRange(year),
        OR: [
          { description: { contains: q, mode: "insensitive" } },
          { merchantName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: limit,
    }),
    loadOverrides(userId, { client }),
  ]);
  const tagged = new Map(
    tagAll(
      rows.map((t) => ({ ...t, date: iso(t.date) })),
      overrides,
    ).map((t) => [t.id, t.tag]),
  );
  return rows.map((t) => ({
    id: t.id,
    date: iso(t.date),
    payee: (t.merchantName ?? t.description).trim(),
    amountCents: t.amountCents,
    tag: tagged.get(t.id) ?? null,
  }));
}

export type TagTarget = { transactionId: string } | { merchantKey: string };

// The person's tag, on one transaction or every one from a merchant. tag null: not for
// taxes. Checked here: the transaction or merchant must be the person's own.
export async function setTaxTag(
  userId: string,
  target: TagTarget,
  tag: TaxTagKind | null,
  { client = defaultClient, via }: { client?: PrismaClient; via: "chat" | "page" },
): Promise<{ count: number }> {
  if (tag !== null && !isTaxTagKind(tag)) throw new TaxOrganizerError("Pick a tag from the list.");
  const db = scopedFor(userId, client);
  const value = tag ?? UNTAGGED;
  let count: number;
  if ("transactionId" in target) {
    const transaction = await db.transactions.findFirst({
      where: { id: target.transactionId },
      select: { id: true },
    });
    if (!transaction) throw new TaxOrganizerError("That transaction isn't there anymore.");
    await db.taxTags.upsert({
      where: { userId_transactionId: { userId, transactionId: transaction.id } },
      create: { userId, transactionId: transaction.id, tag: value },
      update: { tag: value },
    });
    count = 1;
  } else {
    const key = target.merchantKey.trim().toLowerCase();
    const candidates = await db.transactions.findMany({
      where: { amountCents: { gt: 0 } },
      select: { merchantName: true, description: true },
    });
    count = candidates.filter((t) => merchantKeyOf(t) === key).length;
    if (count === 0) throw new TaxOrganizerError("There are no charges from that merchant.");
    await db.taxTags.upsert({
      where: { userId_merchantKey: { userId, merchantKey: key } },
      create: { userId, merchantKey: key, tag: value },
      update: { tag: value },
    });
    // A merchant-wide answer replaces earlier one-off tags on its transactions.
    const ids = (
      await db.taxTags.findMany({
        where: { transactionId: { not: null } },
        select: { id: true, transaction: { select: { merchantName: true, description: true } } },
      })
    ).filter((r) => r.transaction && merchantKeyOf(r.transaction) === key);
    if (ids.length > 0)
      await db.taxTags.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
  }
  await logAudit(
    { type: "user", id: userId },
    "tax_tag_changed",
    { type: "user", id: userId },
    { tag: value, scope: "transactionId" in target ? "transaction" : "merchant", via },
  );
  await track(userId, "tax_tag_changed", { tag: value, via });
  return { count };
}

export type TaxFormsView = {
  year: number;
  forms: (ExpectedForm & { received: boolean })[];
};

export async function loadTaxForms(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxFormsView> {
  const db = scopedFor(userId, client);
  const incomeCategories = Object.values(INCOME_KINDS).flatMap((k) => [...k.categories]);
  const [transactions, accounts, loans, received] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        amountCents: { lt: 0 },
        date: yearRange(year),
        pfcDetailed: { in: incomeCategories },
      },
      select: {
        date: true,
        amountCents: true,
        pfcDetailed: true,
        description: true,
        merchantName: true,
        account: { select: { name: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    // In a fixed order, so the forms always come out in the same order.
    db.accounts.findMany({
      select: { name: true, type: true, subtype: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    // Banks report loan interest for the current year only; for a past year it's unknown.
    db.liabilities.findMany({
      select: { kind: true, ytdInterestPaidCents: true, account: { select: { name: true } } },
      orderBy: [{ account: { name: "asc" } }, { id: "asc" }],
    }),
    db.taxForms.findMany({ where: { year }, select: { key: true } }),
  ]);
  const got = new Set(received.map((r) => r.key));
  const forms = expectedForms({
    year,
    transactions: transactions.map((t) => ({
      date: iso(t.date),
      amountCents: t.amountCents,
      pfcDetailed: t.pfcDetailed,
      description: t.description,
      merchantName: t.merchantName,
      accountName: t.account.name,
    })),
    accounts,
    loans: loans.map((l) => ({
      name: l.account.name,
      kind: l.kind,
      ytdInterestPaidCents: year === now.getUTCFullYear() ? l.ytdInterestPaidCents : null,
    })),
    // Spec step 219: an exchange that sold crypto sends a 1099-DA.
    cryptoSales: (await loadEquityIncome(userId, year, { client, now })).crypto.exchangesSold,
  });
  return { year, forms: forms.map((f) => ({ ...f, received: got.has(f.key) })) };
}

// "I have it" (or not any more) on a form Jane expects.
export async function markTaxForm(
  userId: string,
  year: number,
  key: string,
  received: boolean,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: Options & {
    // Spec step 166: "autopilot" when Jane ticks off a collected form that checks out.
    via: "chat" | "page" | "autopilot";
  },
): Promise<ExpectedForm> {
  const { forms } = await loadTaxForms(userId, year, { client, now });
  const form = forms.find((f) => f.key === key);
  if (!form) throw new TaxOrganizerError("That form isn't on your list anymore.");
  const db = scopedFor(userId, client);
  if (received) {
    await db.taxForms.upsert({
      where: { userId_year_key: { userId, year, key } },
      create: { userId, year, key, receivedAt: now },
      update: {},
    });
  } else {
    await db.taxForms.deleteMany({ where: { year, key } });
  }
  await track(userId, "tax_form_marked", { form: form.formKey, received, via });
  return form;
}
