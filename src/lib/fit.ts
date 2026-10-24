import type { LoanProduct } from "@/config/debt";
import { FIT_CARD_PAYMENT_SHARE, FIT_PRODUCT, FIT_TERMS, type FitNeed } from "@/config/fit";
import type { PrismaClient } from "@/generated/prisma/client";
import { loanPaymentCents, type Debt } from "@/insights/debts";
import { creditBandFor } from "@/lib/credit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadDebts } from "@/lib/debts";
import type { LoanOffer } from "@/lib/lenders/partner";
import { loadProfileInput } from "@/lib/profile";
import { lenderPartnerFor } from "@/lib/refinance";
import { fit, type FitBaseline, type FitResult } from "@/planning/fit";
import { refinanceable } from "@/planning/refinance";
import { fitPersonFrom } from "@/planning/fit-person";

// The perfect fit for borrowing (spec step 281), for one person: the need, what they have now,
// the lender's offers at each usual term, and the fit engine's options (src/planning/fit.ts).
// The chat, the pages, Claude's tools and the detector all read this, so they agree. The
// lender is the stand-in, for demo advice people only; a real account has no offers yet.

type Options = { client?: PrismaClient; now?: Date };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type FitNeedInput = {
  need: FitNeed;
  // What to borrow, in cents; a refinance and a consolidation use what is owed.
  amountCents?: number;
  // The debt to refinance (its key); the one with the highest rate when left out.
  debtKey?: string;
};

export type FitView = FitResult & {
  // Offers come from a partner (the stand-in): without one there are no options.
  available: boolean;
  advice: boolean;
  checkedOn: string;
  // What they pay now on what this replaces.
  baseline: FitBaseline | null;
  // The debt a refinance replaces (its key), so a pick can be priced again; null otherwise.
  debtKey: string | null;
  // The emergency cushion kept back before paying a debt off from cash (one rule everywhere).
  cushionCents?: number | null;
};

const baselineOf = (debt: Debt, asOf: string): FitBaseline | null => {
  if (!debt.balanceCents || debt.aprBps === null || !debt.paymentCents) return null;
  return {
    label: `your ${debt.name}`,
    balanceCents: debt.balanceCents,
    aprBps: debt.aprBps,
    // "Your payment", as every page has it (a mortgage's without its escrow).
    monthlyCents: loanPaymentCents(debt)!,
  };
};

export async function loadFit(
  userId: string,
  want: FitNeedInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<FitView> {
  const asOf = isoDay(now);
  const db = scopedFor(userId, client);
  const [found, book, band, input, report] = await Promise.all([
    lenderPartnerFor(userId, { client }),
    loadDebts(userId, { client, now }),
    creditBandFor(userId, { client }),
    loadProfileInput(userId, { client, now }),
    db.creditReports.findFirst({
      orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
      select: { score: true },
    }),
  ]);
  const person = fitPersonFrom(input, report?.score ?? null);

  let product: LoanProduct;
  // A refinance is picked over the debt's own remaining months, as the offers page compares it.
  let pickTermMonths: number | undefined;
  let baseline: FitBaseline | null = null;
  let debtKey: string | null = null;
  let amountCents = want.amountCents ?? 0;
  if (want.need === "refinance") {
    const debts = book.debts
      .filter((d) => d.kind !== "bnpl" && (d.balanceCents ?? 0) > 0 && d.aprBps !== null)
      .sort((a, b) => (b.aprBps ?? 0) - (a.aprBps ?? 0));
    const debt = want.debtKey ? debts.find((d) => d.key === want.debtKey) : debts[0];
    baseline = debt ? baselineOf(debt, asOf) : null;
    // Keeping it, as the offers page counts it (src/planning/refinance.ts): one horizon.
    const keep = debt ? refinanceable(debt, asOf)?.keep : undefined;
    if (baseline && keep) baseline = { ...baseline, monthlyCents: keep.monthlyCents };
    debtKey = baseline && debt ? debt.key : null;
    product =
      debt?.kind === "mortgage"
        ? "mortgage"
        : debt?.kind === "auto"
          ? "auto"
          : debt?.kind === "student"
            ? "student"
            : "personal";
    amountCents = baseline?.balanceCents ?? 0;
    pickTermMonths = debt ? refinanceable(debt, asOf)?.termMonths : undefined;
  } else if (want.need === "consolidation") {
    product = FIT_PRODUCT.consolidation;
    const cards = book.debts.filter(
      (d) => d.kind === "card" && (d.balanceCents ?? 0) > 0 && d.aprBps !== null,
    );
    const owed = cards.reduce((s, d) => s + (d.balanceCents ?? 0), 0);
    amountCents = owed;
    baseline =
      owed > 0
        ? {
            label: `your ${cards.length === 1 ? "card" : `${cards.length} cards`}`,
            balanceCents: owed,
            aprBps: Math.round(
              cards.reduce((s, d) => s + (d.aprBps ?? 0) * (d.balanceCents ?? 0), 0) / owed,
            ),
            monthlyCents:
              cards.reduce((s, d) => s + (d.paymentCents ?? 0), 0) ||
              Math.round(owed * FIT_CARD_PAYMENT_SHARE),
          }
        : null;
  } else {
    product = FIT_PRODUCT[want.need];
  }

  const empty: FitView = {
    need: want.need,
    amountCents,
    options: [],
    pick: null,
    confidence: null,
    ineligible: [],
    whatWouldHelp: [],
    assumptions: [],
    terms: null,
    available: Boolean(found),
    advice: Boolean(found),
    checkedOn: asOf,
    baseline,
    debtKey,
    cushionCents: person.cushionCents ?? null,
  };
  if (!found || amountCents <= 0) return empty;
  if ((want.need === "refinance" || want.need === "consolidation") && !baseline) return empty;

  const offers: LoanOffer[] = [];
  const terms = [...new Set([...FIT_TERMS[product], ...(pickTermMonths ? [pickTermMonths] : [])])];
  for (const termMonths of terms) {
    offers.push(
      ...(await found.partner.prequalify({
        product,
        amountCents,
        termMonths,
        creditBand: band,
        month: asOf.slice(0, 7),
      })),
    );
  }
  const result = fit({
    need: want.need,
    product,
    amountCents,
    person,
    offers,
    baseline,
    pickTermMonths,
  });
  return {
    ...result,
    available: true,
    advice: true,
    checkedOn: asOf,
    baseline,
    debtKey,
    cushionCents: person.cushionCents ?? null,
  };
}
