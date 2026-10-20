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
  if (!car.available || car.offers.length === 0) return unavailable;
  if (car.missing === "income" || !car.costs || car.maxPriceCents === null) return noIncome;
  const c = car.costs;
  const lines = asked
    ? [
        `A ${formatCents(c.priceCents)} car would cost about ${formatCents(c.allInCents)} a month all in, ${car.withinBudget ? "within" : "over"} the ${formatCents(car.allowanceCents!)} I'd stay under (20% of your income).`,
      ]
    : [
        `You can afford a car up to about ${formatCents(car.maxPriceCents)}, keeping the all-in cost under ${formatCents(car.allowanceCents!)} a month (20% of your income).`,
      ];
  lines.push(
    `That ${asked ? "price" : "car"} is ${formatCents(c.paymentCents)} a month for the loan, ${formatCents(c.insuranceCents)} for insurance, ${formatCents(c.fuelCents)} for fuel and ${formatCents(c.maintenanceCents + c.registrationCents)} for upkeep and registration.`,
  );
  const best = car.offers[0];
  lines.push(
    `The cheapest preapproval is ${best.offer.lender} at ${formatRate(best.offer.aprBps)}: ${formatCents(best.monthlyCents)} a month, ${formatCents(best.totalCents)} in all over ${car.termMonths} months (${best.offer.feeLabel.toLowerCase()}).`,
  );
  if (car.offers.length > 1) {
    lines.push(
      `Also: ${car.offers
        .slice(1, 3)
        .map(
          (o) =>
            `${o.offer.lender} at ${formatRate(o.offer.aprBps)}, ${formatCents(o.totalCents)} in all`,
        )
        .join("; ")}.`,
    );
  }
  return { body: lines.join("\n"), actions: [CAR_PAGE], refs: { advice: true } };
}

// "The dealer offered 7.9% for 72 months."
export function carDealerReply(car: Car): Reply {
  if (!car.available || car.offers.length === 0) return unavailable;
  const d = car.dealer;
  if (!d) {
    return {
      body: "Tell me the dealer's rate, the months and the price, like \"the dealer offered 7.9% for 72 months on $30,000\", and I'll check it against the preapprovals.",
      actions: [CAR_PAGE],
      refs: {},
    };
  }
  const best = car.offers[0];
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
