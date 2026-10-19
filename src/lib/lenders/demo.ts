import { DEMO_LENDERS, demoLenderUrl, type DemoLender } from "@/data-sources/demo/demo-lenders";
import type { LenderPartner, LoanOffer, PrequalifyRequest } from "./partner";

// The stand-in lender partner (spec step 111): offers from the demo catalog, priced by
// the credit band and moving a little from month to month, like real rates. Pure apart
// from applications (spec step 112). Never used for a real account.

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

export const demoLender: LenderPartner = {
  name: "Demo lender catalog (sample offers)",
  async prequalify(request) {
    return DEMO_LENDERS.flatMap((l) => demoQuote(l, request) ?? []);
  },
  async offer(id, request) {
    return (await this.prequalify(request)).find((o) => o.id === id) ?? null;
  },
  async apply() {
    throw new Error("Applying comes with spec step 112.");
  },
  async status() {
    throw new Error("Applying comes with spec step 112.");
  },
};
