import { DAY_MS, isoDay } from "@/lib/dates";
import type { PrismaClient } from "@/generated/prisma/client";
import { TAX_KEPT_NAME, TAX_SET_ASIDE } from "@/config/tax-set-aside";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { cachedCopy } from "@/lib/read-cache";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { todayOf } from "@/lib/today";
import { taxPaymentsFor } from "@/planning/tax-income";
import { workOutSetAside, type TaxSetAside } from "@/planning/tax-set-aside";

// The tax left to cover (src/planning/tax-set-aside.ts), from the person's own estimate: the one
// figure the card, Safe to spend, the chat and the Taxes page all use.

type Options = { client?: PrismaClient; now?: Date };

export type TaxSetAsideView = TaxSetAside & { estimateView: TaxEstimateView };

export async function loadTaxSetAside(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TaxSetAsideView> {
  // The person's own day, not UTC's: the same figure either side of midnight in UTC.
  const today = await todayOf(userId, { client, now });
  return cachedCopy(`taxSetAside:${userId}:${today}`, client, () =>
    work(userId, today, { client, now: new Date(`${today}T12:00:00Z`) }),
  );
}

// What the card needs, for the detectors (src/detectors/tax-set-aside.ts).
export async function taxSetAsideForDetector(userId: string, options: Options = {}) {
  const { estimateView: _view, lines: _lines, ...figure } = await loadTaxSetAside(userId, options);
  return figure;
}

async function work(
  userId: string,
  today: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<TaxSetAsideView> {
  const db = scopedFor(userId, client);
  const [view, advice, savings, goals] = await Promise.all([
    loadTaxEstimate(userId, { client, now }),
    adviceMode(userId, { client }),
    // Not checking: Safe to spend already starts from checking, so money there isn't apart.
    db.accounts.findMany({
      where: { type: "depository", NOT: { subtype: "checking" } },
      select: { id: true, name: true, currentBalanceCents: true },
    }),
    db.savingsGoals.findMany({ select: { name: true, accountId: true, manualSavedCents: true } }),
  ]);
  const yearOver = today > `${view.year}-12-31`;
  // A finished year's bill, paid after the estimate's own window for it closes.
  const lateRows = yearOver
    ? await db.transactions.findMany({
        where: {
          pending: false,
          pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
          date: { gte: new Date(Date.UTC(view.year + 1, 1, 1)) },
        },
        select: {
          date: true,
          amountCents: true,
          pfcDetailed: true,
          description: true,
          merchantName: true,
        },
      })
    : [];
  const late = taxPaymentsFor(
    lateRows.map((t) => ({ ...t, date: isoDay(t.date) })),
    view.year + 1,
  );

  const kept = [
    ...savings.flatMap((a) =>
      TAX_KEPT_NAME.test(a.name) && (a.currentBalanceCents ?? 0) > 0
        ? [{ name: a.name, cents: a.currentBalanceCents ?? 0 }]
        : [],
    ),
    ...goals.flatMap((g) => {
      const account = savings.find((a) => a.id === g.accountId);
      // An account already counted by its own name isn't counted again through its goal.
      if (!TAX_KEPT_NAME.test(g.name) || (account && TAX_KEPT_NAME.test(account.name))) return [];
      const cents = account ? (account.currentBalanceCents ?? 0) : (g.manualSavedCents ?? 0);
      return cents > 0 ? [{ name: `your goal ${g.name}`, cents }] : [];
    }),
  ];
  const { pay, soFar, fixes, elapsed } = view;
  // A stub from months ago says what was withheld then, not now: carried to today at its pace.
  const stale =
    pay.source === "pay_stub" &&
    fixes.withheldCents === null &&
    elapsed < 1 &&
    pay.asOf !== null &&
    (now.getTime() - Date.parse(`${pay.asOf}T00:00:00Z`)) / DAY_MS > TAX_SET_ASIDE.stubFreshDays;
  const withheld = {
    federal: stale
      ? Math.round(pay.projected.federalWithheldCents * elapsed)
      : soFar.federalWithheldCents,
    state: stale
      ? Math.round(pay.projected.stateWithheldCents * elapsed)
      : soFar.stateWithheldCents,
  };
  const aside = workOutSetAside({
    year: view.year,
    today,
    elapsed,
    advice,
    estimate: view.estimate,
    input: view.input,
    withholdingKnown: view.withholdingKnown,
    incomeSoFarCents: view.incomeSoFarCents,
    businessCostsCents: soFar.businessCostsCents,
    businessCostsYearCents: soFar.businessCostsYearCents,
    homeOfficeCents: soFar.homeOfficeCents,
    profitAssumed: soFar.profitAssumed,
    federalWithheldCents: withheld.federal,
    stateWithheldCents: withheld.state,
    withheldFrom: fixes.withheldCents !== null ? "told" : pay.source,
    withheldProjected: stale,
    seenPaidCents: soFar.seenPaidCents + late.federalCents + late.stateCents,
    toldPaidCents: soFar.toldPaidCents,
    keptApart: {
      seenCents: kept.reduce((s, k) => s + k.cents, 0),
      seenIn: kept.map((k) => k.name),
      toldCents: fixes.keptApartCents,
    },
    incomeMonths: soFar.incomeMonths,
    firstSeen: soFar.firstSeen,
    filingStatusKnown: soFar.filingStatusKnown,
    corrected: {
      income: fixes.notIncome.size > 0,
      wages: fixes.wagesCents !== null,
      selfEmployed: fixes.selfEmployedCents !== null,
    },
  });
  return { ...aside, estimateView: view };
}
