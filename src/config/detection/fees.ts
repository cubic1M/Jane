import type { PfcDetailed } from "@/categorize/taxonomy";

// --- Bank fees and card interest ---------------------------------------------------

// Fees a bank or card issuer charged. Interest is its own finding (card interest).
// A fee the bank gave back within this many days (same amount, same category) was never paid
// (messy-bank QA: an overdraft fee reversed two days later still counted).
export const FEE_REVERSAL_DAYS = 30;
export const BANK_FEE_CATEGORIES: readonly PfcDetailed[] = [
  "BANK_FEES_ATM_FEES",
  "BANK_FEES_CASH_ADVANCE",
  "BANK_FEES_FOREIGN_TRANSACTION_FEES",
  "BANK_FEES_INSUFFICIENT_FUNDS",
  "BANK_FEES_LATE_FEES",
  "BANK_FEES_OTHER_BANK_FEES",
  "BANK_FEES_OVERDRAFT_FEES",
];

// Interest on purchases. PFCv2 files cash-advance interest under BANK_FEES_CASH_ADVANCE,
// which the bank fees finding already counts.
export const CARD_INTEREST_CATEGORIES: readonly PfcDetailed[] = ["BANK_FEES_INTEREST_CHARGE"];
