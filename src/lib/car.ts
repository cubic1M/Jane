import {
  CAR_COST_MAX_SHARE,
  CAR_DEALER_FLAG_BPS,
  CAR_DEFAULT_TERM_MONTHS,
  CAR_DOWN_PAYMENT_SHARE,
  CAR_FUEL_MONTHS,
  CAR_INSURANCE_DEFAULT_YEARLY_SHARE,
  CAR_MAINTENANCE_YEARLY_SHARE,
  CAR_REFERENCE_VALUE_CENTS,
  CAR_REGISTRATION_YEARLY_SHARE,
  CAR_TERMS_MONTHS,
} from "@/config/car";
import { loadDetectionInput } from "@/detection/engine";
import { addDays } from "@/detection/units";
import type { DetectionInput } from "@/detection/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { spendingInsights } from "@/insights/spending";
import { creditBandFor } from "@/lib/credit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listPolicies, yearlyPremium } from "@/lib/insurance/policies";
import { lenderPartnerFor } from "@/lib/refinance";
import { formatCents } from "@/lib/money";
import {
  carCosts,
  compareCarOffers,
  dealerCheck,
  insuranceYearlyCents,
  maxAffordablePrice,
  type CarCosts,
  type DealerCheck,
  type ScoredCarOffer,
} from "@/planning/car";

// Buying a car (spec step 178), before the dealer. From the person's own income, current
// auto insurance and gas spending, what they can afford with insurance and running costs
// in; preapproval offers from the lender stand-in compared by total cost; and a dealer's
// financing checked against the best. Demo advice, every assumption shown; nothing is
// applied for here.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export type CarQuestion = {
  priceCents?: number;
  downCents?: number;
  termMonths?: number;
  dealer?: { aprBps: number; termMonths: number; feesCents: number };
};

export type Car = {
  available: boolean;
  // Why there's no answer yet, when there isn't one.
  missing: "income" | null;
  monthlyIncomeCents: number | null;
  termMonths: number;
  // The rate used for the affordability: the best preapproval's.
  aprBps: number | null;
  // The most they can afford, and the price checked (that, or the one asked about).
  maxPriceCents: number | null;
  costs: CarCosts | null;
  allowanceCents: number | null;
  withinBudget: boolean | null;
  offers: ScoredCarOffer[];
  dealer: DealerCheck | null;
  // Every assumption, in words.
  assumptions: string[];
  insuranceFromPolicy: boolean;
};

const none = (termMonths: number): Car => ({
  available: false,
  missing: null,
  monthlyIncomeCents: null,
  termMonths,
  aprBps: null,
  maxPriceCents: null,
  costs: null,
  allowanceCents: null,
  withinBudget: null,
  offers: [],
  dealer: null,
  assumptions: [],
  insuranceFromPolicy: false,
});

export async function loadCar(
  userId: string,
  question: CarQuestion = {},
  { client = defaultClient, now = new Date(), input: given }: Options = {},
): Promise<Car> {
  const termMonths = question.termMonths ?? CAR_DEFAULT_TERM_MONTHS;
  const found = await lenderPartnerFor(userId, { client });
  if (!found) return none(termMonths);
  const asOf = isoDay(now);
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const db = scopedFor(userId, client);
  const [policies, assets, creditBand] = await Promise.all([
    listPolicies(userId, { client }),
    db.ownedAssets.findMany({ where: { kind: "vehicle" }, select: { valueCents: true } }),
    creditBandFor(userId, { client }),
  ]);
  // Full months only: the ones before this one.
  const lastFull = addDays(`${asOf.slice(0, 7)}-01`, -1);
  const months = spendingInsights(
    input.transactions.map((t) => ({ ...t, pending: false })),
    { asOf: lastFull, monthCount: CAR_FUEL_MONTHS },
  ).months.filter((m) => m.incomeCents > 0);
  const monthlyIncomeCents = months.length
    ? Math.round(months.reduce((s, m) => s + m.incomeCents, 0) / months.length)
    : null;
  if (monthlyIncomeCents === null)
    return { ...none(termMonths), available: true, missing: "income" };

  const since = addDays(`${asOf.slice(0, 7)}-01`, -31 * CAR_FUEL_MONTHS);
  const fuelMonthlyCents = Math.round(
    input.transactions
      .filter(
        (t) =>
          t.pfcDetailed === "TRANSPORTATION_GAS" &&
          t.amountCents > 0 &&
          t.date > since &&
          t.date <= lastFull,
      )
      .reduce((s, t) => s + t.amountCents, 0) / CAR_FUEL_MONTHS,
  );
  const auto = policies.find((p) => p.kind === "auto" && yearlyPremium(p) !== null);
  const current = auto
    ? {
        yearlyCents: yearlyPremium(auto)!,
        carValueCents: assets[0]?.valueCents ?? CAR_REFERENCE_VALUE_CENTS,
      }
    : null;
  const insuranceFor = (price: number) => insuranceYearlyCents(price, current);

  // The preapproval offers, for the rate: first at a reference loan to find the best rate,
  // then for the price asked about.
  const offersFor = async (financedCents: number, months: number) =>
    compareCarOffers(
      await found.partner.prequalify({
        product: "auto",
        amountCents: financedCents,
        termMonths: months,
        creditBand,
        month: asOf.slice(0, 7),
      }),
      financedCents,
      months,
    );
  const reference = await offersFor(2_500_000, termMonths);
  const aprBps = reference[0]?.offer.aprBps ?? null;
  if (aprBps === null) return { ...none(termMonths), available: true };

  const downShare = CAR_DOWN_PAYMENT_SHARE;
  const maxPriceCents = maxAffordablePrice({
    monthlyIncomeCents,
    downShare,
    termMonths,
    aprBps,
    insuranceYearlyFor: insuranceFor,
    fuelMonthlyCents,
  });
  const priceCents = question.priceCents ?? maxPriceCents;
  const downCents = question.downCents ?? Math.round(priceCents * downShare);
  const financed = Math.max(0, priceCents - downCents);
  const dealerTerm = question.dealer?.termMonths ?? termMonths;
  const offers = financed > 0 ? await offersFor(financed, dealerTerm) : [];
  const costs = carCosts({
    priceCents,
    downCents,
    termMonths,
    aprBps: offers[0]?.offer.aprBps ?? aprBps,
    insuranceYearlyCents: insuranceFor(priceCents),
    fuelMonthlyCents,
  });
  const allowanceCents = Math.round(monthlyIncomeCents * CAR_COST_MAX_SHARE);
  const dealer =
    question.dealer && offers[0] && financed > 0
      ? dealerCheck(question.dealer, financed, offers[0], CAR_DEALER_FLAG_BPS)
      : null;
  return {
    available: true,
    missing: null,
    monthlyIncomeCents,
    termMonths,
    aprBps,
    maxPriceCents,
    costs,
    allowanceCents,
    withinBudget: costs.allInCents <= allowanceCents,
    offers,
    dealer,
    insuranceFromPolicy: current !== null,
    assumptions: [
      `Income: ${formatCents(monthlyIncomeCents)} a month, your average over the last ${months.length} full ${months.length === 1 ? "month" : "months"}.`,
      `All-in cost at most ${Math.round(CAR_COST_MAX_SHARE * 100)}% of income (${formatCents(allowanceCents)} a month): payment, insurance, fuel, upkeep and registration.`,
      `A ${formatCents(downCents)} down payment, a ${termMonths}-month loan at ${(aprBps / 100).toFixed(2)}%, the best preapproval offer for your credit.`,
      current
        ? `Insurance: your current auto premium, scaled to the price of the car.`
        : `Insurance: ${(CAR_INSURANCE_DEFAULT_YEARLY_SHARE * 100).toFixed(0)}% of the price a year, since you have no auto policy on file.`,
      `Fuel: ${formatCents(fuelMonthlyCents)} a month, from your gas spending. Upkeep ${(CAR_MAINTENANCE_YEARLY_SHARE * 100).toFixed(1)}% and registration ${(CAR_REGISTRATION_YEARLY_SHARE * 100).toFixed(1)}% of the price a year.`,
    ],
  };
}

export { CAR_TERMS_MONTHS };
