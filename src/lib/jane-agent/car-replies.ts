import { CAR_COST_SOURCE } from "@/config/car";
import type { Car } from "@/lib/car";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/insights/loans";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about buying a car (spec step 178), from src/lib/car.ts. Pure. Demo advice:
// every answer carries the label and shows its assumptions on the page.

export const CAR_PAGE: MessageAction = {
  id: "open",
  label: "Plan a car purchase",
  kind: "link",
  href: "/loans/car",
};

const unavailable: Reply = {
  body: "Car loan offers come from a lending partner, and there isn't one for your accounts yet, so I can't plan a purchase yet.",
  actions: [],
  refs: {},
};

const noIncome: Reply = {
  body: "I need to see a few months of income before I can say what car you can afford. Once your paychecks show, I'll work it out.",
  actions: [],
  refs: {},
};

// "How much car can I afford?" and "Can I afford a $30,000 car?"
export function carReply(car: Car, asked: boolean): Reply {
  if (!car.available) return unavailable;
  if (car.missing === "income" || !car.costs || car.maxPriceCents === null) return noIncome;
  const c = car.costs;
  const lines = asked
    ? [
        `A ${formatCents(c.priceCents)} car would cost about ${formatCents(c.allInCents)} a month all in, ${car.withinBudget ? "within" : "over"} the ${formatCents(car.allowanceCents!)} I'd stay under (20% of your income).`,
      ]
    : car.lenderLimitCents !== null
      ? [
          `Your income would carry a car around ${formatCents(car.comfortPriceCents ?? car.maxPriceCents)}, but the most the lenders I check would lend for a car is about ${formatCents(car.lenderLimitCents)}, so a ${formatCents(c.priceCents)} car with ${formatCents(c.downCents)} down is about ${formatCents(c.allInCents)} a month all in.`,
        ]
      : [
          `A comfortable car for you is around ${formatCents(car.comfortPriceCents ?? car.maxPriceCents)}, about ${formatCents(c.allInCents)} a month all in (around 12% of your income); the usual 20% guideline allows up to ${formatCents(car.maxPriceCents)}.`,
        ];
  const best = car.offers[0];
  lines.push(
    `That ${asked ? "price" : "car"} is ${formatCents(c.paymentCents)} a month for the loan plus ${formatCents(c.allInCents - c.paymentCents)} for insurance, fuel and upkeep.`,
    best
      ? `The cheapest preapproval is ${best.offer.lender} at ${formatRate(best.offer.aprBps)}: ${formatCents(best.monthlyCents)} a month, ${formatCents(best.totalCents)} in all over ${car.termMonths} months.`
      : `No lender I check lends ${formatCents(c.financedCents)} for a car${car.lenderLimitCents !== null ? `; the most one would quote is about ${formatCents(car.lenderLimitCents)}` : ""}, so a lower price or a bigger down payment would bring offers.`,
  );
  return { body: lines.join(" "), actions: [CAR_PAGE], refs: { advice: true } };
}

// "The dealer offered 7.9% for 72 months."
export function carDealerReply(car: Car): Reply {
  if (!car.available) return unavailable;
  const d = car.dealer;
  if (!d) {
    return {
      body: "Tell me the dealer's rate, the months and the price, like \"the dealer offered 7.9% for 72 months on $30,000\", and I'll check it against the preapprovals.",
      actions: [CAR_PAGE],
      refs: {},
    };
  }
  const best = car.offers[0];
  if (!best) {
    return {
      body: `No lender I check lends ${formatCents(car.costs?.financedCents ?? 0)} for a car, so I have no preapproval to hold the dealer's offer against. With a lower price or more down, I can compare it.`,
      actions: [CAR_PAGE],
      refs: {},
    };
  }
  const verdict =
    d.verdict === "better"
      ? `The dealer's financing costs ${formatCents(-d.extraCents)} less than my best preapproval (${best.offer.lender}, ${formatCents(best.totalCents)} in all), so it's worth taking.`
      : d.verdict === "worse"
        ? `The dealer's financing costs ${formatCents(d.extraCents)} more than ${best.offer.lender} (${formatRate(best.offer.aprBps)}, ${formatCents(best.totalCents)} in all) because its rate is ${(d.extraBps / 100).toFixed(2)} points higher. Get the preapproval first, then ask the dealer to beat it.`
        : `The dealer's financing costs ${formatCents(d.extraCents)} more than ${best.offer.lender} (${formatCents(best.totalCents)} in all): close, but the preapproval is still cheaper.`;
  return {
    body: `${verdict}\nThe dealer's loan: ${formatCents(d.monthlyCents)} a month, ${formatCents(d.totalCents)} in all.`,
    actions: [CAR_PAGE],
    refs: { advice: true },
  };
}

export const CAR_SOURCE = CAR_COST_SOURCE;
