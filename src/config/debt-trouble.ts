import type { DebtKind } from "@/insights/debts";

// When debt is too much: the facts (spec step 229). Everything Jane says here is a fact or a
// door to knock on, never advice on which to choose and never legal advice. The sentences
// in DEBT_FACTS and COUNSEL_POINTER are reviewed wording: src/lib/guardrails.ts lets exactly
// these sentences through (they name bankruptcy, taxes and attorneys), and blocks everything
// else of that kind.

// Debt payments at or above this share of the monthly income bring this up by itself.
// Lenders themselves start to worry around 43% (the CFPB's old qualified-mortgage line); 40%
// leaves room to act first.
export const TROUBLE_PAYMENT_SHARE = 0.4;
// ...unless the cash on hand covers this many months of those payments (loans QA: a big
// mortgage on a big income, with cash to carry it, isn't trouble). One rule for this message,
// the profile's debt_trouble fact and everything that reads it.
export const TROUBLE_CASH_MONTHS = 3;
// Income is the average of this many full months before this one.
export const TROUBLE_INCOME_MONTHS = 3;

// What to ask each kind of lender, in the person's own debts: the one hardship catalog, for
// /loans/help, the lean plan when income stops (spec step 204) and the chat
// (docs/feature-audit.md, cluster 11). A stand-in: what lenders of each kind commonly offer, said
// as what to ask. A real catalog (per lender) replaces it when a partner is connected.
export const HARDSHIP_PROGRAMS: Readonly<Record<DebtKind, { name: string; ask: string }>> = {
  card: {
    name: "Card hardship program",
    ask: "Ask for a hardship program, which many issuers offer: a lower rate or a smaller or paused payment for a few months, and no late fee while it's in place. Call the number on the back of your card.",
  },
  mortgage: {
    name: "Mortgage forbearance or payment plan",
    ask: "Ask your servicer about forbearance or a payment plan (loss mitigation), as soon as you know and before a payment is missed. A HUD-approved housing counselor can help you ask, free.",
  },
  student: {
    name: "Student loan deferment or income-driven plan",
    ask: "Federal loans have income-driven plans, which can set the payment near zero, and deferment (including for unemployment) and forbearance, all through studentaid.gov. Private lenders set their own hardship options.",
  },
  auto: {
    name: "Auto loan hardship options",
    ask: "Ask about a payment deferral, moving the due date or extending the term. Call before you miss a payment, not after.",
  },
  loan: {
    name: "Loan hardship options",
    ask: "Ask for a hardship plan: a deferred or lower payment for a few months. It's easier to ask before a payment is missed.",
  },
  bnpl: {
    name: "Buy now, pay later",
    ask: "Contact the provider before a due date; many will agree to a new one.",
  },
};
export const HARDSHIP_FINDER = {
  label: "Find a HUD-approved housing counselor (CFPB)",
  url: "https://www.consumerfinance.gov/find-a-housing-counselor/",
};

// A debt management plan runs through a nonprofit credit counselor: one monthly payment to the
// counselor, who negotiates lower rates with the card issuers.
export const COUNSELOR_REFERRALS: readonly { name: string; url: string; note: string }[] = [
  {
    name: "National Foundation for Credit Counseling (NFCC)",
    url: "https://www.nfcc.org/",
    note: "nonprofit member agencies, free first sessions",
  },
  {
    name: "Financial Counseling Association of America (FCAA)",
    url: "https://www.fcaa.org/",
    note: "nonprofit member agencies",
  },
];
// The rate a counselor typically gets a card down to, for the sketch of a plan: a stand-in
// assumption, not an offer, and said so.
export const DMP_ASSUMED_APR_BPS = 800;
export const DMP_NOTE =
  "A debt management plan puts your card payments into one monthly payment to a nonprofit credit counselor, who asks the issuers for lower rates. It usually runs up to five years, costs a small monthly fee, and the cards are closed or limited.";

type Fact = { text: string; source: { label: string; url: string } };
export const DEBT_FACTS: Readonly<{
  settlement: readonly Fact[];
  bankruptcy: readonly Fact[];
  taxes: readonly Fact[];
}> = {
  settlement: [
    {
      text: "Debt settlement means a lender agrees to take less than you owe, usually after months of missed payments, and the late payments and the settled account stay on your credit report for up to seven years.",
      source: {
        label: "CFPB",
        url: "https://www.consumerfinance.gov/consumer-tools/debt-collection/",
      },
    },
    {
      text: "A company that settles debts for you is not allowed to charge a fee before it has settled one.",
      source: {
        label: "FTC",
        url: "https://consumer.ftc.gov/articles/coping-debt",
      },
    },
  ],
  bankruptcy: [
    {
      text: "Chapter 7 bankruptcy clears many debts in a few months and stays on your credit report for up to ten years.",
      source: {
        label: "U.S. Courts",
        url: "https://www.uscourts.gov/court-programs/bankruptcy/bankruptcy-basics",
      },
    },
    {
      text: "Chapter 13 bankruptcy sets a three-to-five-year repayment plan and stays on your credit report for up to seven years.",
      source: {
        label: "U.S. Courts",
        url: "https://www.uscourts.gov/court-programs/bankruptcy/bankruptcy-basics",
      },
    },
    {
      text: "Some debts, such as most student loans, child support and recent taxes, usually aren't cleared by bankruptcy.",
      source: {
        label: "U.S. Courts",
        url: "https://www.uscourts.gov/court-programs/bankruptcy/bankruptcy-basics",
      },
    },
  ],
  taxes: [
    {
      text: "Debt a lender forgives outside bankruptcy is usually reported to the IRS if it's $600 or more, and it can count as income on your tax return.",
      source: { label: "IRS Topic 431", url: "https://www.irs.gov/taxtopics/tc431" },
    },
    {
      text: "Debt cleared in bankruptcy is generally not taxed as income.",
      source: { label: "IRS Topic 431", url: "https://www.irs.gov/taxtopics/tc431" },
    },
  ],
};
export const FACTS_HEADING = "Settlement and bankruptcy, as facts rather than advice:";
export const COUNSEL_POINTER =
  "For what to do in your own situation, ask a bankruptcy attorney or a nonprofit legal aid office, because the rules differ by state and by case.";

// Every sentence the guardrails let through (src/lib/guardrails.ts).
export const APPROVED_DEBT_SENTENCES: readonly string[] = [
  ...DEBT_FACTS.settlement.map((f) => f.text),
  ...DEBT_FACTS.bankruptcy.map((f) => f.text),
  ...DEBT_FACTS.taxes.map((f) => f.text),
  FACTS_HEADING,
  COUNSEL_POINTER,
];
