import { REFI_CARD_TERM_MONTHS } from "@/config/debt";
import { DEBT_DETECTOR_RATES as D } from "@/config/detectors-debt";
import {
  FIT_CARD_PAYMENT_SHARE,
  FIT_CONSOLIDATION_MIN_APR_BPS,
  FIT_CONSOLIDATION_MIN_CENTS,
  FIT_MIN_SAVING_CENTS,
  FIT_TERMS,
} from "@/config/fit";
import { DEMO_LENDERS } from "@/data-sources/demo/demo-lenders";
import { demoQuote } from "@/lib/lenders/demo";
import type { LoanOffer } from "@/lib/lenders/partner";
import { formatCents } from "@/lib/money";
import { fit } from "@/planning/fit";
import { fitPersonFrom } from "@/planning/fit-person";
import { type Detector, suggestionId } from "./contract";
import { evidence, headlineOf, outCents, tx, weakest } from "./helpers";

// The perfect fit for borrowing (spec step 276): cards that could be one cheaper loan. The same
// fit engine as the chat's options card and Claude's tool (src/planning/fit.ts), priced from
// the stand-in lender catalog's typical rates. Pure; see ./contract.ts. Someone in debt trouble
// is steered to a payoff or hardship plan instead, never to a new loan.

const consolidation: Detector = {
  capability: "debt",
  topic: "consolidation",
  covers: ["loan_fit"],
  needs: [],
  detect({ profile, data }) {
    if (profile.facts.debt_trouble.value === true) return null;
    const cards = data.accounts.filter((a) => a.type === "credit" && a.balanceCents > 0);
    const rate = (id: string) => data.liabilities.find((l) => l.accountId === id)?.aprBps ?? null;
    const owed = cards.reduce((s, c) => s + c.balanceCents, 0);
    if (owed < FIT_CONSOLIDATION_MIN_CENTS) return null;
    // The cards' own rates when the bank gives them; otherwise what the interest charges in the
    // payments work out to on what is owed (a guess, and the confidence says so).
    const allRated = cards.every((c) => rate(c.id) !== null);
    const charges = tx(data, (t) => t.pfc === "BANK_FEES_INTEREST_CHARGE");
    const yearlyInterest = Math.round((outCents(charges) * 12) / Math.max(1, profile.months));
    const apr = allRated
      ? Math.round(cards.reduce((s, c) => s + (rate(c.id) ?? 0) * c.balanceCents, 0) / owed)
      : Math.round((yearlyInterest / owed) * 10_000);
    if (apr < FIT_CONSOLIDATION_MIN_APR_BPS) return null;
    const rated = cards;
    const paid = tx(data, (t) => t.pfc === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    const seen = Math.round(outCents(paid) / Math.max(1, profile.months));
    const monthlyCents = seen > 0 ? seen : Math.round(owed * FIT_CARD_PAYMENT_SHARE);
    const month = data.today.slice(0, 7);
    const offers: LoanOffer[] = DEMO_LENDERS.flatMap((l) =>
      FIT_TERMS.personal.flatMap(
        (termMonths) =>
          demoQuote(l, {
            product: "personal",
            amountCents: owed,
            termMonths,
            creditBand: "good",
            month,
          }) ?? [],
      ),
    );
    const result = fit({
      need: "consolidation",
      product: "personal",
      amountCents: owed,
      person: fitPersonFrom(data),
      offers,
      baseline: {
        label: rated.length === 1 ? "your card" : `your ${rated.length} cards`,
        balanceCents: owed,
        aprBps: apr,
        monthlyCents,
        remainingMonths: REFI_CARD_TERM_MONTHS,
      },
    });
    const pick = result.options.find((o) => o.id === result.pick);
    if (!pick || pick.id === "keep" || (pick.savesCents ?? 0) < FIT_MIN_SAVING_CENTS) return null;
    const saves = pick.savesCents ?? 0;
    // A 0% transfer (the balance_transfer suggestion) is the same card interest saved another
    // way: ranking counts only what this saves beyond it, so the dollars aren't counted twice.
    const transferSaves =
      owed >= D.transferMinBalanceCents && yearlyInterest >= D.transferMinInterestCents
        ? Math.max(0, yearlyInterest - Math.round(owed * D.transferFeeShare))
        : 0;
    return {
      id: suggestionId("debt", "consolidation"),
      capability: "debt",
      topic: "consolidation",
      title: "Move your card debt to one cheaper loan",
      headline: headlineOf("Move your cards to one cheaper loan", saves, "saves", true),
      short: `${formatCents(owed)} on cards at ${(apr / 100).toFixed(1)}% could be one loan at ${(pick.aprBps / 100).toFixed(2)}%.`,
      worthCents: saves,
      worthKind: "saves",
      ...(transferSaves > 0 ? { rankCents: Math.max(0, saves - transferSaves) } : {}),
      confidence: weakest([
        allRated
          ? evidence("seen", profile.months, rated.length, "cards with a rate")
          : {
              ...evidence("seen", profile.months, charges.length, "interest charges"),
              percent: Math.min(
                70,
                evidence("seen", profile.months, charges.length, "interest charges").percent,
              ),
              reason: `the rate is worked out from ${evidence("seen", profile.months, charges.length, "interest charges").reason}`,
            },
        result.confidence ?? { percent: 65, reason: "the offers are typical rates" },
      ]),
      urgency: "later",
      why: `You owe ${formatCents(owed)} on ${rated.length === 1 ? `a card at ${(apr / 100).toFixed(1)}%` : `${rated.length} cards at ${(apr / 100).toFixed(1)}% on average`}. ${pick.lender} at ${(pick.aprBps / 100).toFixed(2)}% over ${pick.termMonths / 12} years would cost about ${formatCents(saves)} less in all, fees counted, at ${formatCents(pick.paymentCents)} a month.`,
      action: { label: "Compare your options", href: "/loans/refinance" },
    };
  },
};

export const FIT_DETECTORS: readonly Detector[] = [consolidation];
