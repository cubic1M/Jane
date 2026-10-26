import { GIVING } from "@/config/giving";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { donorFundPartnerFor } from "@/lib/donor-fund";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import { givingOptions, needsReceipt, type GivingOption } from "@/planning/giving";
import { DAY_MS, isoDay as iso } from "@/lib/dates";

// Giving, done smart (spec step 168): the gifts Jane found (tagged as donations, step
// 119), which need the charity's receipt, and in demo advice mode the options that do more
// good for the same money, each as the tax with and without it, plus a donor-advised fund
// through the stand-in. Nothing here moves money.

type Options = { client?: PrismaClient; now?: Date };

export class GivingError extends Error {}

export type Gift = {
  transactionId: string;
  date: string;
  payee: string;
  cents: number;
  needsReceipt: boolean;
  receipted: boolean;
  reminded: boolean;
};

export type GivingView = {
  year: number;
  advice: boolean;
  gifts: Gift[];
  totalCents: number;
  // A year's giving: this year's or last year's, whichever is more.
  yearlyCents: number;
  // Demo advice: worth bringing up (saving at least GIVING.minSavingCents).
  options: GivingOption[];
  receiptsMissing: Gift[];
  fund: { name: string; partner: string; openedAt: string } | null;
  // Said no to the options this year.
  dismissed: boolean;
  // From GIVING.from to the year's end: when Jane brings the options up.
  inSeason: boolean;
};

export async function loadGiving(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<GivingView> {
  const [estimate, advice] = loaded
    ? [loaded.estimate, loaded.advice]
    : await Promise.all([loadTaxEstimate(userId, { client, now }), adviceMode(userId, { client })]);
  const year = estimate.year;
  const db = scopedFor(userId, client);
  const [tags, lastYear, profile, investments] = await Promise.all([
    loadTaxTags(userId, year, { client }),
    loadTaxTags(userId, year - 1, { client }),
    db.taxProfiles.findFirst({
      select: {
        givingReceipts: true,
        givingDismissedYear: true,
        donorFundPartner: true,
        donorFundName: true,
        donorFundOpenedAt: true,
      },
    }),
    advice ? loadInvestmentTaxes(userId, year, { client, now }) : null,
  ]);
  const receipts = new Set(profile?.givingReceipts ?? []);
  const gifts: Gift[] = tags.tagged
    .filter((t) => t.tag === "donation")
    .map((t) => ({
      transactionId: t.id,
      date: t.date,
      payee: t.payee,
      cents: t.amountCents,
      needsReceipt: needsReceipt(t.amountCents),
      receipted: receipts.has(t.id),
      reminded: receipts.has(`reminded:${t.id}`),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const totalCents = gifts.reduce((s, g) => s + g.cents, 0);
  const yearlyCents = Math.max(totalCents, lastYear.totals.donation.totalCents);
  const options = advice
    ? givingOptions({
        input: estimate.input,
        yearlyCents,
        shares: (investments?.unrealised ?? [])
          .filter((u) => u.longTermCents > 0)
          .map((u) => ({
            name: u.holding.ticker ?? u.holding.name,
            valueCents: u.holding.valueCents,
            longTermGainCents: u.longTermCents,
          })),
      }).filter((o) => o.savesCents >= GIVING.minSavingCents)
    : [];
  const today = iso(now);
  return {
    year,
    advice,
    gifts,
    totalCents,
    yearlyCents,
    options,
    receiptsMissing: gifts.filter((g) => g.needsReceipt && !g.receipted),
    fund:
      profile?.donorFundName && profile.donorFundPartner && profile.donorFundOpenedAt
        ? {
            name: profile.donorFundName,
            partner: profile.donorFundPartner,
            openedAt: iso(profile.donorFundOpenedAt),
          }
        : null,
    dismissed: profile?.givingDismissedYear === year,
    inSeason: today.startsWith(String(year)) && today.slice(5) >= GIVING.from,
  };
}

async function addToReceipts(userId: string, entry: string, client: PrismaClient) {
  const db = scopedFor(userId, client);
  const existing = await db.taxProfiles.findFirst({ select: { givingReceipts: true } });
  const givingReceipts = [...new Set([...(existing?.givingReceipts ?? []), entry])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, givingReceipts },
    update: { givingReceipts },
  });
}

// "I have the receipt" on a gift.
export async function markReceipt(
  userId: string,
  transactionId: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<Gift> {
  const view = await loadGiving(userId, { client, now });
  const gift = view.gifts.find((g) => g.transactionId === transactionId);
  if (!gift) throw new GivingError("That gift isn't in this year's donations.");
  await addToReceipts(userId, transactionId, client);
  await track(userId, "giving_receipt_marked", { via });
  return gift;
}

// At the levels that let Jane act: a reminder to get each missing receipt, due by the end
// of January, when the return needs it.
export async function remindReceipts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const view = await loadGiving(userId, { client, now });
  let added = 0;
  for (const g of view.receiptsMissing.filter((g) => !g.reminded)) {
    await addDeadline(
      userId,
      {
        title: `Get the receipt for your gift to ${g.payee}`,
        dueOn: `${view.year + 1}-01-31`,
        kind: "other",
        note: `Gifts of $${GIVING.receiptFromCents / 100} or more need the charity's written receipt to count on your taxes.`,
      },
      { client, now },
    );
    await addToReceipts(userId, `reminded:${g.transactionId}`, client);
    added += 1;
  }
  return added;
}

// "Not this year" on the giving options.
export async function dismissGiving(
  userId: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  const year = (await loadTaxEstimate(userId, { client, now })).year;
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, givingDismissedYear: year },
    update: { givingDismissedYear: year },
  });
  await track(userId, "giving_dismissed", { via });
}

// Opens a donor-advised fund with the stand-in (demo advice mode only) and puts funding it
// on the deadlines. The person moves the money.
export async function openDonorFund(
  userId: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<{ fundName: string; amountCents: number; dueOn: string }> {
  const partner = await donorFundPartnerFor(userId, { client });
  if (!partner) {
    throw new GivingError("A donor-advised fund is only offered in demo advice mode for now.");
  }
  const view = await loadGiving(userId, { client, now });
  if (view.fund) throw new GivingError(`You already have ${view.fund.name}.`);
  const fundOption = view.options.find((o) => o.key === "fund");
  if (!fundOption) throw new GivingError("A donor-advised fund wouldn't save you tax this year.");
  const { fundName } = await partner.openFund({ holder: userId });
  const db = scopedFor(userId, client);
  await db.taxProfiles.upsert({
    where: { userId },
    create: {
      userId,
      donorFundPartner: partner.name,
      donorFundName: fundName,
      donorFundOpenedAt: now,
    },
    update: { donorFundPartner: partner.name, donorFundName: fundName, donorFundOpenedAt: now },
  });
  const amountCents = view.yearlyCents * GIVING.bunchYears;
  const yearEnd = `${view.year}-12-31`;
  const soon = iso(new Date(now.getTime() + 7 * DAY_MS));
  const dueOn = soon < yearEnd ? soon : yearEnd;
  await addDeadline(
    userId,
    {
      title: `Put $${Math.round(amountCents / 100).toLocaleString("en-US")} into ${fundName}`,
      dueOn,
      kind: "other",
      note: `Funded by December 31, it counts for ${view.year}. The fund then sends your charities a gift each year.`,
    },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "donor_fund_opened",
    { type: "user", id: userId },
    { partner: partner.name, via },
  );
  await track(userId, "donor_fund_opened", { partner: partner.name, via });
  return { fundName, amountCents, dueOn };
}
