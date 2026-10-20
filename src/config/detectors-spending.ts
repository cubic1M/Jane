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
  // Fixed price: at least this share of the earlier charges were exactly the same amount.
  fixedPriceShare: 0.7,
  // Bill negotiation: internet and phone bills this size or bigger a month, and the share
  // people usually get off by asking (the playbooks in src/config/playbooks.ts).
  internetBillMinCents: 7_000,
  phoneBillMinCents: 8_000,
  negotiationShare: 0.12,
  // The same charge twice within this many days.
  duplicateChargeDays: 3,
  duplicateChargeMinCents: 500,
  // A free trial: a charge this small or smaller, then a bigger one from the same merchant.
  trialMaxCents: 200,
  trialConvertedMinCents: 500,
  // Low balance: checking and savings hold less than this share of a month's regular bills.
  lowBalanceShare: 1,
  // Budgets: a category's last full month is this much over its three-month average, and at
  // least this much more, outside housing, loans and transfers.
  budgetOverrunShare: 0.4,
  budgetOverrunMinCents: 15_000,
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
