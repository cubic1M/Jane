import { DEBT_DETECTOR_RATES as D } from "@/config/detectors-debt";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { ADDON_RULES } from "@/config/car-loan";
import { formatCents } from "@/lib/money";
import type { Profile } from "@/profile/build";
import { addonCandidates, refundFor } from "@/planning/car-loan";
import { type Detector, suggestionId } from "./contract";
import {
  evidence,
  factEvidence,
  liquidCents,
  monthlySpendCents,
  outCents,
  tx,
  weakest,
} from "./helpers";

// Detectors for debt and credit (spec step 260): the loans a person already has, and the extra
// money or costly borrowing around them. Pure; see ./contract.ts. Each reads only the profile
// and the rows behind it; the pages and chat answers behind the buttons are the lane's own.

const balanceOf = (
  accounts: readonly { subtype: string | null; balanceCents: number }[],
  subtype: string,
) =>
  accounts.filter((a) => a.subtype === subtype).reduce((s, a) => s + Math.abs(a.balanceCents), 0);

const income = (profile: Profile) =>
  typeof profile.facts.monthly_income.value === "number" ? profile.facts.monthly_income.value : 0;

// Student loan payments well above what an income-driven plan would ask.
const studentRepayment: Detector = {
  capability: "debt",
  topic: "student_repayment",
  needs: ["monthly_income"],
  detect({ profile, data }) {
    const payments = tx(data, (t) => t.pfc === "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT");
    if (payments.length < D.studentPaymentsMin || balanceOf(data.accounts, "student") <= 0) {
      return null;
    }
    const monthly = outCents(payments) / Math.max(1, profile.months);
    const idr = Math.round(income(profile) * D.studentIdrShare);
    const gap = Math.round(monthly - idr);
    if (income(profile) <= 0 || gap < D.studentMinGapCents) return null;
    return {
      id: suggestionId("debt", "student_repayment"),
      capability: "debt",
      topic: "student_repayment",
      title: "Compare an income-driven plan for your student loans",
      worthCents: gap * 12,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, payments.length, "student loan payments"),
        factEvidence(profile.facts.monthly_income),
      ]),
      urgency: "later",
      why: `You pay about ${formatCents(Math.round(monthly))} a month on student loans; an income-driven plan on ${formatCents(income(profile))} a month would ask roughly ${formatCents(idr)}.`,
      action: { label: "Compare repayment plans", href: "/loans/student" },
    };
  },
};

// A car payment that takes a big share of income: the loan's rate and any dealer add-ons.
const autoRefinance: Detector = {
  capability: "debt",
  topic: "auto_refinance",
  needs: ["monthly_income"],
  detect({ profile, data }) {
    const payments = tx(data, (t) => t.pfc === "LOAN_PAYMENTS_CAR_PAYMENT");
    const balance = balanceOf(data.accounts, "auto");
    if (payments.length < D.autoPaymentsMin || balance <= 0 || income(profile) <= 0) return null;
    const monthly = outCents(payments) / Math.max(1, profile.months);
    const share = monthly / income(profile);
    if (share < D.autoPaymentShare) return null;
    return {
      id: suggestionId("debt", "auto_refinance"),
      capability: "debt",
      topic: "auto_refinance",
      title: "Check whether a cheaper car loan exists, and whether the dealer added extras",
      worthCents: Math.round((balance * D.autoRefiGapBps) / 10_000),
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, payments.length, "car payments"),
        factEvidence(profile.facts.monthly_income),
      ]),
      urgency: "later",
      why: `Your car payment is about ${formatCents(Math.round(monthly))} a month, ${Math.round(share * 100)}% of the ${formatCents(income(profile))} you bring in, on ${formatCents(balance)} owed. A lower rate or cancelling dealer add-ons can bring it down.`,
      action: { label: "Check my car loan", href: "/loans/auto" },
    };
  },
};

// A dealer add-on (GAP, a warranty, a service contract) found in the payments, with the refund
// cancelling it could give, by the same rules as the car loan page (step 245).
const carAddons: Detector = {
  capability: "debt",
  topic: "car_addons",
  needs: [],
  detect({ profile, data }) {
    if (balanceOf(data.accounts, "auto") <= 0) return null;
    const found = addonCandidates(
      data.transactions
        .filter((t) => t.amountCents >= D.addonMinCents)
        .map((t, i) => ({
          id: `${i}`,
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
          merchantName: null,
        })),
    );
    const refunds = found.map((a) => ({
      a,
      refund: refundFor({
        kind: a.kind,
        paidCents: a.paidCents,
        termMonths: ADDON_RULES[a.kind].defaultTermMonths,
        startedOn: a.startedOn,
        today: data.today,
      }),
    }));
    const worth = refunds.reduce((s, r) => s + r.refund.refundCents, 0);
    if (worth <= 0) return null;
    return {
      id: suggestionId("debt", "car_addons"),
      capability: "debt",
      topic: "car_addons",
      title: "Cancel the dealer add-on you may not need and ask for the refund",
      worthCents: worth,
      worthKind: "earns",
      // The charge looks like an add-on by its words; whether it is one is the person's to say.
      confidence: evidence(
        "guessed",
        profile.months,
        found.length,
        "payments that look like dealer add-ons",
      ),
      urgency: "soon",
      why: `You paid ${formatCents(refunds.reduce((s, r) => s + r.a.paidCents, 0))} for ${found.map((f) => ADDON_RULES[f.kind].label.toLowerCase()).join(" and ")}; the unused part could refund about ${formatCents(worth)}.`,
      action: { label: "See the refund", href: "/loans/auto" },
    };
  },
};

// A card cash advance: a fee at once and interest from day one.
const cashAdvance: Detector = {
  capability: "debt",
  topic: "cash_advance",
  needs: [],
  detect({ profile, data }) {
    const cards = new Set(
      data.accounts.filter((a) => a.subtype === "credit card").map((a) => a.id),
    );
    const fees = tx(data, (t) => t.pfc === "BANK_FEES_CASH_ADVANCE");
    const advances = tx(
      data,
      (t) =>
        t.amountCents > 0 &&
        t.pfc !== "BANK_FEES_CASH_ADVANCE" &&
        cards.has(t.accountId) &&
        /cash (?:adv|advance)/i.test(t.description),
    );
    const count = Math.max(fees.length, advances.length);
    if (count < D.cashAdvanceMin) return null;
    const interest = Math.round(
      (outCents(advances) * D.cashAdvanceAprBps * D.cashAdvanceDays) / 10_000 / 365,
    );
    const cost = outCents(fees) + interest;
    if (cost <= 0) return null;
    return {
      id: suggestionId("debt", "cash_advance"),
      capability: "debt",
      topic: "cash_advance",
      title: "Stop taking cash advances on your card",
      worthCents: cost,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, count, "card cash advances"),
      urgency: "soon",
      why: `Your card cash advances cost about ${formatCents(cost)} in fees and interest from day one. A credit union small loan or a pay advance from work costs far less.`,
      action: { label: "See cheaper ways", href: "/loans/costly" },
    };
  },
};

// Idle cash and a mortgage that charges more than the cash earns.
const mortgageExtra: Detector = {
  capability: "debt",
  topic: "mortgage_extra",
  needs: ["mortgage_rate_bps"],
  detect({ profile, data }) {
    const rate = profile.facts.mortgage_rate_bps;
    const balance = balanceOf(data.accounts, "mortgage");
    if (typeof rate.value !== "number" || rate.value < D.mortgageExtraMinBps || balance <= 0) {
      return null;
    }
    const spend = monthlySpendCents(data, profile.months);
    const excess = Math.min(balance, liquidCents(data) - spend * R.idleMonthsKept);
    if (spend === 0 || excess < D.mortgageExtraMinExcessCents) return null;
    return {
      id: suggestionId("debt", "mortgage_extra"),
      capability: "debt",
      topic: "mortgage_extra",
      title: "Compare paying extra on your mortgage with what the cash earns now",
      worthCents: Math.round((excess * (rate.value - R.highYieldBps)) / 10_000),
      worthKind: "saves",
      confidence: weakest([
        factEvidence(rate),
        evidence("seen", profile.months, data.accounts.length, "accounts"),
      ]),
      urgency: "later",
      why: `Your mortgage charges ${(rate.value / 100).toFixed(2)}% on ${formatCents(balance)}, and ${formatCents(excess)} of your cash is beyond ${R.idleMonthsKept} months of spending. Paying down earns the mortgage rate for certain; a high-yield account earns ${(R.highYieldBps / 100).toFixed(1)}%.`,
      action: { label: "Compare recast, refinance and extra", href: "/loans/recast" },
    };
  },
};

// Card interest big enough that a 0% transfer would save after its fee.
const balanceTransfer: Detector = {
  capability: "debt",
  topic: "balance_transfer",
  needs: ["card_debt_cents"],
  detect({ profile, data }) {
    const debt = profile.facts.card_debt_cents;
    const charges = tx(data, (t) => t.pfc === "BANK_FEES_INTEREST_CHARGE");
    const interest = outCents(charges);
    if (
      typeof debt.value !== "number" ||
      debt.value < D.transferMinBalanceCents ||
      interest < D.transferMinInterestCents
    ) {
      return null;
    }
    const saving = interest - Math.round(debt.value * D.transferFeeShare);
    if (saving <= 0) return null;
    const trouble = profile.facts.debt_trouble.value === true;
    return {
      id: suggestionId("debt", "balance_transfer"),
      capability: "debt",
      topic: "balance_transfer",
      title: "See if a 0% transfer card would cut your interest",
      worthCents: saving,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, charges.length, "interest charges"),
        factEvidence(debt),
        // Approval depends on credit Jane can't see; someone in debt trouble may not qualify.
        ...(trouble
          ? [
              evidence(
                "guessed",
                profile.months,
                charges.length,
                "interest charges (approval isn't certain)",
              ),
            ]
          : []),
      ]),
      urgency: "soon",
      why: `You owe ${formatCents(debt.value)} on cards and paid ${formatCents(interest)} in interest over ${profile.months} months. A 0% transfer with a ${Math.round(D.transferFeeShare * 100)}% fee (${formatCents(Math.round(debt.value * D.transferFeeShare))}) could save about ${formatCents(saving)}.`,
      action: { label: "See transfer offers", href: "/loans/refinance" },
    };
  },
};

export const DEBT_DETECTORS: readonly Detector[] = [
  studentRepayment,
  autoRefinance,
  carAddons,
  cashAdvance,
  mortgageExtra,
  balanceTransfer,
];
