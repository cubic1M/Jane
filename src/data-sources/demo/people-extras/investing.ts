import type { PersonId } from "@/config/people";
import type { PersonExtra } from "../demo-people";

// What the investing lane adds to the sample people's lives so its detectors (src/detectors) have
// signals to find. Add entries to a person's list; use keys unique to this lane (prefix them
// "investing-"). Don't edit ../demo-people.ts. Every sample person's written lists are in
// src/config/people.ts; a detector must fire for the people it is for and for no one on a
// must-not list.
export const INVESTING_EXTRAS: Partial<Record<PersonId, PersonExtra>> = {
  // Priya: bond funds sitting in the taxable brokerage while her 401(k) holds stocks.
  equity: {
    positions: [{ account: "brokerage", key: "KTBIX", quantity: 1500, basis: 14500 }],
    // Her annual bonus, paid into checking a few days before the sample date.
    once: [
      {
        key: "investing-bonus",
        account: "checking",
        name: "ACME CORP ANNUAL BONUS",
        merchant: null,
        category: "INCOME_OTHER",
        amount: -12000,
        offsets: [-9],
      },
    ],
  },
  // Dan and Lena: a 401(k) left at a past employer, in a costly fund.
  preretire: {
    accounts: [
      {
        key: "investing-old401k",
        name: "Former Employer 401(k)",
        mask: "7101",
        type: "investment",
        subtype: "401k",
        balance: 0,
      },
    ],
    positions: [
      { account: "investing-old401k", key: "PDIFX", quantity: 1100, basis: 21000 },
      { account: "investing-old401k", key: "CASH", quantity: 0, basis: 0, cash: 0 },
    ],
  },
  // Ruth: a fixed annuity bought years ago.
  retiree: {
    accounts: [
      {
        key: "investing-annuity",
        name: "Fixed Annuity",
        mask: "7201",
        type: "investment",
        subtype: "annuity",
        balance: 0,
      },
    ],
    positions: [{ account: "investing-annuity", key: "CASH", quantity: 0, basis: 0, cash: 85000 }],
  },
};
