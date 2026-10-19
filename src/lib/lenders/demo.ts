import { DEMO_LOAN_FUNDING_DAYS } from "@/config/debt";
import {
  DEMO_LENDERS,
  DEMO_TRANSFER_CARDS,
  demoLenderUrl,
  type DemoLender,
} from "@/data-sources/demo/demo-lenders";
import type {
  LenderPartner,
  LoanOffer,
  PrequalifyRequest,
  TransferOffer,
  TransferRequest,
} from "./partner";

// The stand-in lender partner (spec step 111): offers from the demo catalog, priced by
// the credit band and moving a little from month to month, like real rates; applications
// approve at once on the offer's terms and fund a few days after acceptance (spec step
// 112). Never used for a real account.

const DAY_MS = 24 * 60 * 60 * 1000;
const BAND_BPS = { excellent: -50, good: 0, fair: 150 } as const;
// The month's move for each lender, in basis points.
const MOVES = [-25, -15, -5, 0, 5, 15, 25];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function demoQuote(lender: DemoLender, request: PrequalifyRequest): LoanOffer | null {
  if (lender.product !== request.product) return null;
  if (request.termMonths < lender.minTermMonths || request.termMonths > lender.maxTermMonths) {
    return null;
  }
  if (request.amountCents < lender.minAmountCents || request.amountCents > lender.maxAmountCents) {
    return null;
  }
  const move = MOVES[hash(`${lender.key}|${request.month}`) % MOVES.length];
  const aprBps = lender.baseAprBps + BAND_BPS[request.creditBand] + move;
  return {
    id: `demo-${lender.key}-${aprBps}-${request.termMonths}`,
    lender: lender.name,
    product: lender.product,
    aprBps,
    rateType: lender.rateType,
    termMonths: request.termMonths,
    feeCents: Math.round(request.amountCents * lender.feeShare) + lender.feeFlatCents,
    feeLabel: lender.feeLabel,
    sourceUrl: demoLenderUrl(lender.key),
    demo: true,
  };
}

// Spec step 113: the stand-in 0% transfer cards that take this amount, with the fee on it.
export function demoTransfers(request: TransferRequest): TransferOffer[] {
  return DEMO_TRANSFER_CARDS.flatMap((card) => {
    if (request.amountCents > card.maxAmountCents) return [];
    const feeCents =
      card.feeShare === 0
        ? 0
        : Math.max(card.feeMinCents, Math.round(request.amountCents * card.feeShare));
    return [
      {
        id: `demo-bt-${card.key}-${card.promoMonths}`,
        issuer: card.issuer,
        cardName: card.name,
        promoMonths: card.promoMonths,
        feeCents,
        feeLabel:
          card.feeShare === 0
            ? "No transfer fee"
            : `${Math.round(card.feeShare * 100)}% transfer fee`,
        goToAprBps: card.goToAprBps + BAND_BPS[request.creditBand],
        sourceUrl: demoLenderUrl(card.key),
        demo: true,
      },
    ];
  });
}

export const demoLender: LenderPartner = {
  name: "Demo lender catalog (sample offers)",
  async prequalify(request) {
    return DEMO_LENDERS.flatMap((l) => demoQuote(l, request) ?? []);
  },
  async balanceTransfers(request) {
    return demoTransfers(request);
  },
  async offer(id, request) {
    return (await this.prequalify(request)).find((o) => o.id === id) ?? null;
  },
  // The soft check stand-in: approves an offer that's still in the catalog this month, at
  // its terms, and declines one that isn't.
  async apply({ offer, request }) {
    const still = await this.offer(offer.id, request);
    return {
      applicationId: `demo-app-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      status: still ? "approved" : "declined",
    };
  },
  async accept() {},
  // Funded DEMO_LOAN_FUNDING_DAYS after the person accepted.
  async status(_applicationId, { now, acceptedAt }) {
    if (!acceptedAt) return "approved";
    return now.getTime() - acceptedAt.getTime() >= DEMO_LOAN_FUNDING_DAYS * DAY_MS
      ? "funded"
      : "accepted";
  },
};
