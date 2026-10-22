import type { PersonId } from "@/config/people";
import type { PersonExtra } from "../demo-people";

// What the insurance lane adds to the sample people's lives so its detectors (src/detectors/
// insurance.ts) have signals to find (spec step 259). Keys are prefixed "insurance-". Every
// sample person's written lists are in src/config/people.ts; a detector must fire for the
// people it is for and for no one on a must-not list.

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

const INSURANCE = "GENERAL_SERVICES_INSURANCE";
const OLD_MONTHS = [11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

export const INSURANCE_EXTRAS: Partial<Record<PersonId, PersonExtra>> = {
  // Maya: her car insurance went up in September ($118 to $131), and she moved a few weeks ago.
  renter: {
    monthly: [
      R(
        "insurance-auto-old",
        "checking",
        "PROGRESSIVE AUTO",
        INSURANCE,
        118,
        [12],
        "Progressive",
        OLD_MONTHS,
      ),
      R(
        "insurance-auto-new",
        "checking",
        "PROGRESSIVE AUTO",
        INSURANCE,
        131,
        [12],
        "Progressive",
        [9, 10],
      ),
    ],
    once: [
      O(
        "insurance-movers",
        "card",
        "TWO MEN AND A TRUCK",
        "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        340,
        [-50],
        "Two Men and a Truck",
      ),
    ],
  },
  // The Reyes: a collision repair paid out of pocket, with no claim payout in sight.
  family: {
    monthly: [
      R(
        "insurance-rx",
        "card",
        "CVS PHARMACY",
        "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
        24,
        [9],
        "CVS",
      ),
    ],
    once: [
      O(
        "insurance-pediatrics",
        "card",
        "FAMILY PEDIATRICS",
        "MEDICAL_PRIMARY_CARE",
        180,
        [-150],
        "Family Pediatrics",
      ),
      O(
        "insurance-imaging",
        "card",
        "BAYVIEW IMAGING CENTER",
        "MEDICAL_PRIMARY_CARE",
        2100,
        [-60],
        "Bayview Imaging Center",
      ),
      O(
        "insurance-collision",
        "card",
        "ABC COLLISION CENTER",
        "GENERAL_SERVICES_AUTOMOTIVE",
        3100,
        [-24],
        "ABC Collision Center",
      ),
    ],
  },
  // Sam: drives a lot and pays for no car insurance.
  freelancer: {
    monthly: [R("insurance-gas", "card", "SHELL OIL", "TRANSPORTATION_GAS", 55, [4, 18], "Shell")],
  },
  // Priya: a phone protection plan and a premium card that already covers phones.
  equity: {
    monthly: [
      R("insurance-asurion", "card", "ASURION PHONE PROTECTION", INSURANCE, 17, [5], "Asurion"),
    ],
    once: [
      O(
        "insurance-card-fee",
        "card",
        "CHASE SAPPHIRE RESERVE ANNUAL FEE",
        "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        550,
        [-100],
        "Chase",
      ),
    ],
  },
  // Dan and Lena: a private term life policy while still working for an employer.
  preretire: {
    monthly: [
      R("insurance-life", "checking", "NEW YORK LIFE TERM", INSURANCE, 110, [15], "New York Life"),
    ],
  },
};
