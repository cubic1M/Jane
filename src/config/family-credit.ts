// Helping family with credit (spec step 249): an authorized user on a card, a first card for a
// student, and co-signing. What each does to credit is stated as ranges and rules with where
// they come from; none of it is a promise or legal advice (counsel for the legal questions).

export const FAMILY_KINDS = ["authorized_user", "first_card", "cosigned"] as const;
export type FamilyKind = (typeof FAMILY_KINDS)[number];

export const FAMILY_LABELS: Readonly<Record<FamilyKind, string>> = {
  authorized_user: "Authorized user",
  first_card: "First card",
  cosigned: "Co-signed loan",
};

// An authorized user's effect on both scores, as a range of points and when it applies. Ranges
// are typical, not promised: scoring models differ, and some ignore authorized users.
export const AUTHORIZED_USER = {
  // Utilisation on the card, as a share of its limit, under which adding someone is low risk.
  safeUtilisation: 0.3,
  // The person added with no file or a thin one usually gains by inheriting the card's on-time
  // history and low use; the primary rarely gains.
  addedGainsPoints: { low: 0, high: 60 },
  // Added to a card that runs high or has late payments, both lose.
  primaryRisk:
    "The card's history shows on both reports: a late payment or high use hurts you both.",
  // How many days the person can remove someone; no waiting.
  removal:
    "You can remove an authorized user any time by asking the card company; the card's history then drops off their report.",
  source: {
    label: "CFPB: authorized users and credit",
    url: "https://www.consumerfinance.gov/ask-cfpb/",
  },
} as const;

// A first card for a student. Under 21 the CARD Act needs the student's own income or a
// co-signer; the options are the usual first-card kinds.
export const FIRST_CARD = {
  minimumAge: 18,
  under21Rule:
    "Under 21, a card issuer needs the student's own income or an adult co-signer (the CARD Act).",
  options: [
    {
      label: "Student card",
      note: "No deposit; a low limit; needs some income, even part-time or a scholarship for expenses.",
    },
    {
      label: "Secured card",
      note: "A refundable deposit (often $200 to $500) sets the limit; no income test beyond the deposit.",
    },
    {
      label: "Authorized user first",
      note: "Starts a file with no application; the student can apply on their own later.",
    },
  ],
  habits: [
    "Use it for one small, regular bill and pay the full statement balance every month.",
    "Turn on autopay for at least the minimum, and an alert for the due date.",
    "Keep use under 30% of the limit.",
  ],
  source: {
    label: "CFPB: credit cards for young adults",
    url: "https://www.consumerfinance.gov/consumer-tools/credit-cards/",
  },
} as const;

// Co-signing: the facts the person should have in front of them. Plain statements of how credit
// reporting treats it; what the lender can do is a legal question for counsel.
export const COSIGNING = {
  facts: [
    "The loan is on your credit report as yours, with the full balance and payment.",
    "Every payment the other person misses is reported against you too.",
    "The lender can ask you for the whole balance if payments aren't made.",
    "It counts in your own debt-to-income when you apply for credit.",
  ],
  legalNote:
    "What a lender may do if payments stop depends on your contract and your state, so take that question to counsel.",
  source: {
    label: "FTC: cosigning a loan",
    url: "https://consumer.ftc.gov/articles/cosigning-loan-what-you-need-know",
  },
} as const;

// A rough yearly worth of starting a young person's file, for a suggestion: the interest saved
// on a first car loan (this amount, term and rates) when a file exists. A guess, stated.
export const FILE_START = {
  firstLoanCents: 1_500_000,
  termMonths: 60,
  thinFileAprBps: 1_400,
  fairAprBps: 1_000,
  note: "a first $15,000 car loan over 5 years at 14% with no file against 10% with one",
} as const;

// A recorded name is kept to this length.
export const PERSON_MAX = 80;
