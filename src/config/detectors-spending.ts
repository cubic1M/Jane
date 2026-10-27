// Numbers the spending, bills and cash detectors (spec step 263) use. Never inline in
// src/detectors. Kept apart from src/config/detectors.ts so lanes adding detectors don't collide.

export const SPENDING_DETECTOR_RATES = {
  // Two or more regular charges in one of these kinds of subscription are a duplicate.
  duplicateCategories: [
    "ENTERTAINMENT_TV_AND_MOVIES",
    "ENTERTAINMENT_MUSIC_AND_AUDIO",
    "ENTERTAINMENT_VIDEO_GAMES",
  ],
  // A charge is regular when it appears in at least this many different months.
  regularMonthsMin: 3,
  // A price rise: the latest charge is this much above the earlier typical one, and at least
  // this many cents more.
  priceRiseShare: 0.05,
  priceRiseMinCents: 100,
  priceRiseMinCharges: 4,
  // Rent has its own detector (rent_increase, against the usual local rise), so a lease that
  // renewed higher isn't also said as a price rise.
  priceRiseNot: ["RENT_AND_UTILITIES_RENT"] as readonly string[],
  // Fixed price: at least this share of the earlier charges were exactly the same amount.
  fixedPriceShare: 0.7,
  // Bill negotiation: internet and phone bills this size or bigger a month, and the share
  // people usually get off by asking (the playbooks in src/config/playbooks.ts).
  internetBillMinCents: 7_000,
  phoneBillMinCents: 8_000,
  negotiationShare: 0.12,
  // A free trial: a charge this small or smaller, then a bigger one from the same merchant.
  trialMaxCents: 200,
  trialConvertedMinCents: 500,
  // Low balance: checking and savings hold less than this share of a month's regular bills.
  lowBalanceShare: 1,
  // Under this share of a month's bills in cash is urgent, and counts for this share of what is
  // short when ranking.
  lowCashUrgentShare: 0.5,
  lowCashRank: 0.25,
  // Budgets: a category's last full month is this much over its three-month average, and at
  // least this much more, outside housing, loans and transfers.
  budgetOverrunShare: 0.4,
  budgetOverrunMinCents: 15_000,
  // The average is of the months before that the data covers in full, and needs this many
  // (overnight upload QA: statements from Jul 28 averaged Aug with an empty Jun and four days
  // of Jul, so September always "ran over").
  budgetOverrunMinMonths: 2,
  budgetExcludedPrefixes: [
    "RENT_AND_UTILITIES",
    "LOAN_PAYMENTS",
    "LOAN_DISBURSEMENTS",
    "TRANSFER",
    "INCOME",
    "BANK_FEES",
    "GENERAL_SERVICES_INSURANCE",
    "GENERAL_SERVICES_CHILDCARE",
    "MEDICAL",
    "GOVERNMENT_AND_NON_PROFIT",
  ],
} as const;
