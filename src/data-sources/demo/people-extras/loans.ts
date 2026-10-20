import type { PersonId } from "@/config/people";
import type { PersonExtra } from "../demo-people";

// What the loans lane adds to the sample people's lives so its detectors (src/detectors) have
// signals to find (spec steps 260, 263 and 266). Keys are prefixed "loans-". Every sample person's
// written lists are in src/config/people.ts; a detector must fire for the people it is for and
// for no one on a must-not list.

const R = (
  key: string,
  account: string,
  name: string,
  category: string,
  amount: number,
  days: number[],
  merchant: string | null = name,
  months?: number[],
) => ({ key, account, name, merchant, category, amount, days, months }) as never;

const O = (
  key: string,
  account: string,
  name: string,
  category: string,
  amount: number,
  offsets: number[],
  merchant: string | null = name,
) => ({ key, account, name, merchant, category, amount, offsets }) as never;

export const LOANS_EXTRAS: Partial<Record<PersonId, PersonExtra>> = {
  // Maya: Audible went up in September ($14.95 to $16.45), and a Skillshare trial ($0.99)
  // turned into $13.99 charges.
  renter: {
    monthly: [
      R(
        "loans-audible-old",
        "card",
        "AUDIBLE",
        "ENTERTAINMENT_OTHER_ENTERTAINMENT",
        14.95,
        [8],
        "Audible",
        [11, 12, 1, 2, 3, 4, 5, 6, 7, 8],
      ),
      R(
        "loans-audible-new",
        "card",
        "AUDIBLE",
        "ENTERTAINMENT_OTHER_ENTERTAINMENT",
        16.45,
        [8],
        "Audible",
        [9],
      ),
    ],
    once: [
      O(
        "loans-skill-trial",
        "card",
        "SKILLSHARE",
        "GENERAL_SERVICES_EDUCATION",
        0.99,
        [-50],
        "Skillshare",
      ),
      O(
        "loans-skill-paid",
        "card",
        "SKILLSHARE",
        "GENERAL_SERVICES_EDUCATION",
        13.99,
        [-43, -13],
        "Skillshare",
      ),
    ],
  },
  // The Reyes: dinner charged twice, a GAP add-on bought with the car loan, and a catered party
  // that put last month's food spending well over the usual.
  family: {
    once: [
      O(
        "loans-dup-dinner",
        "card",
        "OLIVE GARDEN",
        "FOOD_AND_DRINK_RESTAURANT",
        68.4,
        [-21, -20],
        "Olive Garden",
      ),
      O(
        "loans-gap",
        "checking",
        "DEALER GAP INSURANCE",
        "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
        695,
        [-300],
        null,
      ),
      O(
        "loans-party",
        "card",
        "PARTY CATERING CO",
        "FOOD_AND_DRINK_RESTAURANT",
        1100,
        [-30],
        "Party Catering Co",
      ),
    ],
  },
  // Sam: a student loan on a payment sized for a salary, against uneven freelance income.
  freelancer: {
    accounts: [
      {
        key: "loans-student",
        name: "Demo Student Loan",
        mask: "3004",
        type: "loan",
        subtype: "student",
        balance: 38000,
      },
    ],
    monthly: [
      R(
        "loans-student",
        "checking",
        "NELNET STUDENT LOAN",
        "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
        450,
        [20],
        "Nelnet",
      ),
    ],
  },
  // Chris: a cash advance on a card, with its fee.
  debt: {
    once: [
      O("loans-cashadv", "card", "ATM CASH ADVANCE", "TRANSFER_OUT_WITHDRAWAL", 200, [-33], null),
      O("loans-cashadvfee", "card", "CASH ADVANCE FEE", "BANK_FEES_CASH_ADVANCE", 10, [-33], null),
    ],
  },
};
