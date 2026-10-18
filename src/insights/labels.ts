// Plain names for Plaid's primary categories on the insights page.
export const CATEGORY_LABELS: Record<string, string> = {
  INCOME: "Income",
  LOAN_DISBURSEMENTS: "Loan money in",
  LOAN_PAYMENTS: "Loan payments",
  TRANSFER_IN: "Transfers in",
  TRANSFER_OUT: "Transfers out",
  BANK_FEES: "Bank fees and interest",
  ENTERTAINMENT: "Entertainment",
  FOOD_AND_DRINK: "Food and drink",
  GENERAL_MERCHANDISE: "Shopping",
  HOME_IMPROVEMENT: "Home",
  MEDICAL: "Medical",
  PERSONAL_CARE: "Personal care",
  GENERAL_SERVICES: "Services",
  GOVERNMENT_AND_NON_PROFIT: "Government and donations",
  TRANSPORTATION: "Transportation",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Rent and utilities",
  OTHER: "Other",
};

export const UNCATEGORIZED = "Uncategorized";

export function categoryLabel(primary: string | null): string {
  return primary ? (CATEGORY_LABELS[primary] ?? primary) : UNCATEGORIZED;
}
