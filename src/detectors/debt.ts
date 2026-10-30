import { DEBT_DETECTOR_RATES as D } from "@/config/detectors-debt";
import { rateMonthsOf } from "@/profile/build";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { ADDON_RULES } from "@/config/car-loan";
import { formatCents } from "@/lib/money";
import type { Profile } from "@/profile/build";
import { addonCandidates, refundFor } from "@/planning/car-loan";
import { type Detector, suggestionId } from "./contract";
import {
  evidence,
  factEvidence,
  listOf,
  liquidCents,
  nice,
  monthlySpendCents,
  outCents,
  tx,
  weakest,
  headlineOf,
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
  covers: ["student_loans"],
  needs: ["monthly_income"],
  detect({ profile, data }) {
    const payments = tx(data, (t) => t.pfc === "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT");
    if (payments.length < D.studentPaymentsMin || balanceOf(data.accounts, "student") <= 0) {
      return null;
    }
    const monthly = outCents(payments) / rateMonthsOf(profile);
    const idr = Math.round(income(profile) * D.studentIdrShare);
    const gap = Math.round(monthly - idr);
    if (income(profile) <= 0 || gap < D.studentMinGapCents) return null;
    return {
      id: suggestionId("debt", "student_repayment"),
      capability: "debt",
      topic: "student_repayment",
      title: "Compare an income-driven plan for your student loans",
      headline: headlineOf("Compare an income-driven loan plan", gap * 12, "saves"),
      short: `You pay about ${formatCents(Math.round(monthly))} a month on student loans.`,
      worthCents: gap * 12,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, payments.length, "student loan payments"),
        factEvidence(profile.facts.monthly_income),
        // Income-driven plans are for federal loans, and the payments don't say which this is.
        evidence(
          "guessed",
          profile.months,
          payments.length,
          "student loan payments (I can't tell if it's federal)",
        ),
      ]),
      urgency: "later",
      why: `You pay about ${formatCents(Math.round(monthly))} a month on student loans. If they're federal, an income-driven plan on your ${formatCents(income(profile))} a month would ask roughly ${formatCents(idr)}.`,
      action: { label: "Compare repayment plans", href: "/loans/student" },
    };
  },
};

// A car payment that takes a big share of income: the loan's rate and any dealer add-ons.
const autoRefinance: Detector = {
  capability: "debt",
  topic: "auto_refinance",
  covers: ["car_loan"],
  needs: ["monthly_income"],
  detect({ profile, data }) {
    const payments = tx(data, (t) => t.pfc === "LOAN_PAYMENTS_CAR_PAYMENT");
    const balance = balanceOf(data.accounts, "auto");
    if (payments.length < D.autoPaymentsMin || balance <= 0 || income(profile) <= 0) return null;
    const monthly = outCents(payments) / rateMonthsOf(profile);
    const share = monthly / income(profile);
    if (share < D.autoPaymentShare) return null;
    return {
      id: suggestionId("debt", "auto_refinance"),
      capability: "debt",
      topic: "auto_refinance",
      title: "Check whether a cheaper car loan exists, and whether the dealer added extras",
      headline: headlineOf(
        "Check for a cheaper car loan",
        Math.round((balance * D.autoRefiGapBps) / 10_000),
        "saves",
      ),
      short: `Your car payment is about ${formatCents(Math.round(monthly))} a month on ${formatCents(balance)} owed.`,
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
  covers: ["car_loan"],
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
      headline: headlineOf("Cancel a dealer add-on", worth, "earns", true),
      short: `The unused part of what you paid could refund about ${formatCents(worth)}.`,
      worthCents: worth,
      worthKind: "earns",
      // The charge looks like an add-on by its words; whether it is one is the person's to say.
      confidence: evidence(
        "guessed",
        profile.months,
        found.length,
        "payments that look like dealer add-ons (only you can say)",
      ),
      urgency: "soon",
      why: `You paid ${formatCents(refunds.reduce((s, r) => s + r.a.paidCents, 0))} for ${found.map((f) => ADDON_RULES[f.kind].label.replace(/^(?!GAP)\w/, (c) => c.toLowerCase())).join(" and ")}; the unused part could refund about ${formatCents(worth)}.`,
      action: { label: "See the refund", href: "/loans/auto" },
    };
  },
};

// A card cash advance: a fee at once and interest from day one.
const cashAdvance: Detector = {
  capability: "debt",
  topic: "cash_advance",
  covers: ["costly_borrowing"],
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
      headline: headlineOf("Stop taking card cash advances", cost, "saves"),
      short: `Your card cash advances cost about ${formatCents(cost)} in fees and interest.`,
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
  covers: ["mortgage_money"],
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
      headline: headlineOf(
        "Weigh extra mortgage payments",
        Math.round((excess * (rate.value - R.highYieldBps)) / 10_000),
        "saves",
      ),
      short: `Your mortgage charges ${(rate.value / 100).toFixed(2)}% on ${formatCents(balance)}.`,
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
  covers: ["balance_transfers"],
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
      headline: headlineOf("Try a 0% balance transfer card", saving, "saves"),
      short: `You owe ${formatCents(debt.value)} on cards and paid ${formatCents(interest)} in interest.`,
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
      ...(trouble ? { rankCents: Math.round(saving * D.troubleDiscount) } : {}),
      why: `You owe ${formatCents(debt.value)} on cards and paid ${formatCents(interest)} in interest over ${profile.months} months. A 0% transfer with a ${Math.round(D.transferFeeShare * 100)}% fee (${formatCents(Math.round(debt.value * D.transferFeeShare))}) could save about ${formatCents(saving)}.`,
      action: { label: "See transfer offers", href: "/loans/refinance" },
    };
  },
};

// Cards in use above 30% of their limits: the balance the card reports lowers the score, and
// paying down before the statement closes brings it under.
const creditUtilisation: Detector = {
  covers: ["credit_score", "credit_building"],
  capability: "debt",
  topic: "credit_building",
  needs: ["card_debt_cents"],
  detect({ profile, data }) {
    const cards = data.accounts.filter(
      (a) => a.subtype === "credit card" && typeof a.limitCents === "number" && a.limitCents > 0,
    );
    const limit = cards.reduce((n, a) => n + (a.limitCents ?? 0), 0);
    const owed = cards.reduce((n, a) => n + Math.max(0, Math.abs(a.balanceCents)), 0);
    if (limit <= 0 || owed / limit < D.utilisationHigh) return null;
    const toThirty = Math.ceil(owed - limit * D.utilisationHigh);
    const trouble = profile.facts.debt_trouble.value === true;
    const cash = liquidCents(data);
    const share = Math.round((owed / limit) * 100);
    return {
      id: suggestionId("debt", "credit_building"),
      capability: "debt",
      topic: "credit_building",
      title: "Pay your cards down before the statement closes, so a lower balance is reported",
      headline: headlineOf(
        "Pay cards down before the statement",
        Math.round((owed * D.utilisationRateBenefitBps) / 10_000),
        "saves",
      ),
      short: `Your cards hold ${formatCents(owed)} of ${formatCents(limit)} in limits.`,
      // What getting under the line is usually worth: a better pricing tier, about 1.5 points off
      // the rate on what's owed. An estimate, so not what the pay-down itself costs.
      worthCents: Math.round((owed * D.utilisationRateBenefitBps) / 10_000),
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, cards.length, "cards with a limit"),
        factEvidence(profile.facts.card_debt_cents),
        // The pricing tier a lender offers isn't something Jane can see.
        evidence(
          "guessed",
          profile.months,
          cards.length,
          "cards (the rate you're offered is up to the lender)",
        ),
      ]),
      urgency: "soon",
      ...(trouble
        ? {
            rankCents: Math.round(
              ((owed * D.utilisationRateBenefitBps) / 10_000) * D.troubleDiscount,
            ),
          }
        : {}),
      why: `Your cards hold ${formatCents(owed)} of ${formatCents(limit)} in limits, ${share}%. ${
        cash >= toThirty
          ? `Paying ${formatCents(toThirty)} before the statement closes brings the balance reported under ${Math.round(D.utilisationHigh * 100)}%`
          : `Under ${Math.round(D.utilisationHigh * 100)}% would take ${formatCents(toThirty)}, more than the ${formatCents(cash)} you have in cash, so pay what you can before each statement closes; every dollar off the balance reported helps`
      }, which helps your score and the rates you're offered.`,
      action: { label: "See your credit score", href: "/loans/credit" },
    };
  },
};

// Pay in 4 and other pay-later plans paid over and over.
const bnplPlans: Detector = {
  covers: ["bnpl_installments"],
  capability: "debt",
  topic: "bnpl",
  needs: [],
  detect({ profile, data }) {
    const payments = tx(data, (t) => t.pfc === "LOAN_PAYMENTS_BNPL" && t.amountCents > 0);
    if (payments.length < D.bnplPaymentsMin) return null;
    const total = outCents(payments);
    return {
      id: suggestionId("debt", "bnpl"),
      capability: "debt",
      topic: "bnpl",
      title: "Put your pay-later installments in your forecast so they never catch you short",
      headline: headlineOf("Plan for pay-later installments", total, "risk"),
      short: `You've paid ${formatCents(total)} in ${payments.length} pay-later installments.`,
      worthCents: total,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, payments.length, "pay-later installments"),
      urgency: "soon",
      why: `You've paid ${formatCents(total)} in ${payments.length} pay-later installments over ${profile.months} months. Jane can count the next ones against what's safe to spend, and tell you before a new plan strains the month.`,
      action: { label: "See your installments", href: "/loans" },
    };
  },
};

// Medical care paid for out of pocket: an itemized bill, financial assistance or a no-interest
// plan can lower it.
const medicalBills: Detector = {
  covers: ["medical_bills"],
  capability: "debt",
  topic: "medical_bills",
  needs: [],
  detect({ profile, data }) {
    const care = tx(
      data,
      (t) =>
        (t.pfc ?? "").startsWith("MEDICAL_") &&
        t.pfc !== "MEDICAL_PHARMACIES_AND_SUPPLEMENTS" &&
        t.pfc !== "MEDICAL_VETERINARY_SERVICES" &&
        t.amountCents > 0,
    );
    const total = outCents(care);
    if (total < D.medicalMinCents) return null;
    return {
      id: suggestionId("debt", "medical_bills"),
      capability: "debt",
      topic: "medical_bills",
      title:
        "Ask for an itemized bill, and for financial help or a no-interest plan, on your medical bills",
      headline: headlineOf(
        "Ask for help with medical bills",
        Math.round(total * D.medicalAskShare),
        "saves",
      ),
      short: `You paid ${formatCents(total)} for medical care in ${profile.months} months.`,
      worthCents: Math.round(total * D.medicalAskShare),
      worthKind: "saves",
      confidence: evidence("seen", profile.months, care.length, "medical bills"),
      urgency: "soon",
      why: `You paid ${formatCents(total)} for medical care in ${profile.months} months. Bills often have errors, and nonprofit hospitals must offer financial assistance; people who ask usually get about ${Math.round(D.medicalAskShare * 100)}% off.`,
      action: { label: "Check your medical bills", href: "/loans/medical" },
    };
  },
};

// Payments to a collection agency: a debt on the credit report that can be checked.
const collections: Detector = {
  covers: ["credit_report_fixes"],
  capability: "debt",
  topic: "credit_report_errors",
  needs: [],
  detect({ profile, data }) {
    const paid = tx(data, (t) => t.amountCents > 0 && D.collectorPayee.test(t.description));
    if (paid.length === 0) return null;
    const total = outCents(paid);
    return {
      id: suggestionId("debt", "credit_report_errors"),
      capability: "debt",
      topic: "credit_report_errors",
      title:
        "Check the collection on your credit report before you pay more, and ask for it in writing",
      headline: headlineOf("Check a collection before paying", total, "risk"),
      short: `You've paid ${formatCents(total)} to a collection agency in ${profile.months} months.`,
      worthCents: total,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, paid.length, "payments to a collector"),
      urgency: "now",
      why: `You've paid ${formatCents(total)} to a collection agency in ${profile.months} months. Collections can be wrong or too old to collect, and a validation letter makes the collector prove the debt; Jane writes it.`,
      action: { label: "Check your report", href: "/loans/report" },
    };
  },
};

// A student loan and a public-service employer: Public Service Loan Forgiveness could forgive
// what ten years of payments leave.
const studentForgiveness: Detector = {
  covers: ["student_long_game"],
  capability: "debt",
  topic: "student_forgiveness",
  needs: ["employer"],
  detect({ profile, data }) {
    const employer = profile.facts.employer;
    if (typeof employer.value !== "string" || !D.publicEmployer.test(employer.value)) return null;
    const payments = tx(data, (t) => t.pfc === "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT");
    const balance = balanceOf(data.accounts, "student");
    if (payments.length < D.studentPaymentsMin || balance <= 0) return null;
    const monthly = outCents(payments) / rateMonthsOf(profile);
    const left = Math.round(balance - monthly * D.pslfPayments);
    if (left <= 0) return null;
    return {
      id: suggestionId("debt", "student_forgiveness"),
      capability: "debt",
      topic: "student_forgiveness",
      title: "Check Public Service Loan Forgiveness: you work for a public employer",
      headline: headlineOf("Check loan forgiveness (PSLF)", left, "earns", true),
      short: `You work for ${nice(employer.value)} and owe ${formatCents(balance)} on student loans.`,
      worthCents: left,
      worthKind: "earns",
      confidence: weakest([
        factEvidence(employer),
        evidence("seen", profile.months, payments.length, "student loan payments"),
        // Eligibility turns on the loan type, the plan and the employer's status.
        evidence(
          "guessed",
          profile.months,
          payments.length,
          "payments (eligibility isn't certain)",
        ),
      ]),
      urgency: "later",
      why: `You work for ${nice(employer.value)} and owe ${formatCents(balance)} on student loans at about ${formatCents(Math.round(monthly))} a month. After ${D.pslfPayments} qualifying payments the rest, about ${formatCents(left)} at these payments, can be forgiven if the loan and the plan qualify.`,
      action: { label: "Track your qualifying payments", href: "/loans/student" },
    };
  },
};

// Money sent to a person through a payment app that no one has sent back: possibly a loan.
const familyLoans: Detector = {
  covers: ["family_loans"],
  capability: "debt",
  topic: "family_loans",
  needs: [],
  detect({ profile, data }) {
    // Only plain transfers: rent or a bill paid through the app is what it says (overnight
    // upload QA: three months of Zelle rent showed as "Money lent in the family $5.5k").
    const sent = tx(
      data,
      (t) =>
        t.amountCents >= D.familyLoanMinCents &&
        D.paymentApp.test(t.description) &&
        !/\bfrom\b/i.test(t.description) &&
        (t.pfc === null || t.pfc.startsWith("TRANSFER_OUT")),
    );
    const back = tx(data, (t) => t.amountCents < 0 && D.paymentApp.test(t.description));
    if (sent.length === 0 || back.length > 0) return null;
    const total = outCents(sent);
    return {
      id: suggestionId("debt", "family_loans"),
      capability: "debt",
      topic: "family_loans",
      title: "Note down money you lent, so it's remembered and a kind reminder is easy",
      headline: headlineOf("Note down money you lent", total, "risk"),
      short: `You sent ${formatCents(total)} through a payment app and nothing has come back.`,
      worthCents: total,
      worthKind: "risk",
      // The payment alone doesn't say it was a loan; only the person can.
      confidence: evidence("guessed", profile.months, sent.length, "large payment-app transfers"),
      urgency: "later",
      why: `You sent ${formatCents(total)} through a payment app and nothing has come back. If it was a loan, Jane can keep track of it and draft a kind reminder for you to send; it never messages the other person.`,
      action: { label: "Who owes whom", href: "/loans/family" },
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
  creditUtilisation,
  bnplPlans,
  medicalBills,
  collections,
  studentForgiveness,
  familyLoans,
];
