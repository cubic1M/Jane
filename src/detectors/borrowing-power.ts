import {
  BORROW_DETECT_DOWN_SHARE,
  BORROW_PROBE_CENTS,
  BORROW_ROUND_CENTS,
  BORROW_STEP_DOWN,
  BORROW_STEP_TRIES,
  BORROW_UNEVEN_EVIDENCE,
} from "@/config/borrowing-power";
import { FIT_OFFER_EVIDENCE } from "@/config/fit";
import { DEMO_LENDERS } from "@/data-sources/demo/demo-lenders";
import { demoQuote } from "@/lib/lenders/demo";
import type { LoanOffer } from "@/lib/lenders/partner";
import { formatCents } from "@/lib/money";
import { bandOf, priced, targetAmount } from "@/planning/borrowing-power";
import { fitPersonFrom } from "@/planning/fit-person";
import { levelPaymentCents } from "@/planning/refinance";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, headlineOf, liquidCents, weakest } from "./helpers";

// What you could borrow (spec step 250), brought unasked: someone renting on a wage or uneven pay,
// not in debt trouble, with cash for a down payment, is shown what a mortgage would look like
// and what comparing lenders is worth (the dearest against the cheapest stand-in rate on that
// amount, a year). The same planner and fit engine as /loans/borrow, priced from the stand-in
// catalog's typical rates. Pure; see ./contract.ts.

const mortgageQuotes = (amountCents: number, score: number | null, month: string): LoanOffer[] =>
  DEMO_LENDERS.flatMap(
    (l) =>
      demoQuote(l, {
        product: "mortgage",
        amountCents,
        termMonths: 360,
        creditBand: bandOf(score),
        month,
      }) ?? [],
  );

const borrowingPower: Detector = {
  capability: "debt",
  topic: "borrowing_power",
  covers: ["borrowing_power"],
  needs: ["housing", "income_pattern", "monthly_income"],
  detect({ profile, data }) {
    const { housing, income_pattern: pattern, monthly_income: income } = profile.facts;
    // Pay from a business isn't the person's own income to a lender; uneven pay counts, with
    // less confidence (lenders want two years of tax returns for it).
    if (housing.value !== "rent" || (pattern.value !== "salary" && pattern.value !== "uneven")) {
      return null;
    }
    if (profile.facts.debt_trouble.value === true) return null;
    const person = fitPersonFrom(data);
    const month = data.today.slice(0, 7);
    const target = targetAmount(
      person,
      "mortgage",
      mortgageQuotes(BORROW_PROBE_CENTS.mortgage, null, month),
    );
    if (!target || target.amountCents <= 0) return null;
    let amount = target.amountCents;
    let offers = mortgageQuotes(amount, null, month);
    for (let i = 0; i < BORROW_STEP_TRIES && offers.length === 0 && amount > 0; i++) {
      amount =
        Math.floor((amount * BORROW_STEP_DOWN) / BORROW_ROUND_CENTS.mortgage) *
        BORROW_ROUND_CENTS.mortgage;
      offers = mortgageQuotes(amount, null, month);
    }
    const figure = priced(person, "mortgage", amount, offers, target.limit);
    if (!figure.available || figure.aprBps === null) return null;
    const cash = liquidCents(data);
    if (cash < figure.amountCents * BORROW_DETECT_DOWN_SHARE) return null;
    // Comparing lenders: a year of payments at the dearest quote against the cheapest.
    const rates = offers.map((o) => o.aprBps);
    const payment = (bps: number) => levelPaymentCents(figure.amountCents, bps, 360);
    const worth = (payment(Math.max(...rates)) - payment(Math.min(...rates))) * 12;
    if (worth <= 0) return null;
    return {
      id: suggestionId("debt", "borrowing_power"),
      capability: "debt",
      topic: "borrowing_power",
      title: "See what you could borrow for a home, and compare lenders first",
      headline: headlineOf("Compare lenders before you borrow", worth, "saves"),
      short: `On your pay, a mortgage of about ${formatCents(figure.amountCents)} would fit.`,
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(income),
        factEvidence(housing),
        evidence("seen", profile.months, offers.length, "lender quotes"),
        FIT_OFFER_EVIDENCE,
        ...(pattern.value === "uneven" ? [BORROW_UNEVEN_EVIDENCE] : []),
      ]),
      urgency: "later",
      why: `You rent, and lenders would count your pay. A mortgage of about ${formatCents(figure.amountCents)} would keep the payment (${formatCents(figure.paymentCents)} a month) inside what lenders allow and what stays comfortable, and you have ${formatCents(cash)} in cash toward a down payment. Quotes differ by lender: the dearest would cost about ${formatCents(worth)} more a year than the cheapest. Checking is a soft pull and doesn't touch your score.`,
      action: { label: "See what you could borrow", href: "/loans/borrow" },
    };
  },
};

export const BORROWING_POWER_DETECTORS: readonly Detector[] = [borrowingPower];
