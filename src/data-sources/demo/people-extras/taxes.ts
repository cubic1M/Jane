import type { PersonId } from "@/config/people";
import type { PersonExtra, Recurring } from "../demo-people";

// What the taxes lane adds to the sample people's lives so its detectors (src/detectors) have
// signals to find. Add entries to a person's list; use keys unique to this lane (prefix them
// "taxes-"). Don't edit ../demo-people.ts. Every sample person's written lists are in
// src/config/people.ts; a detector must fire for the people it is for and for no one on a
// must-not list.

// Property tax, paid to the county in two instalments (April and December).
const propertyTax = (dollars: number): Recurring => ({
  key: "taxes-property-tax",
  account: "checking",
  name: "COUNTY TAX COLLECTOR PROPERTY TAX",
  merchant: "County Tax Collector",
  category: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
  amount: dollars,
  days: [10],
  months: [4, 12],
});

// A gift to a charity: a single one big enough to need the charity's written receipt.
const gift = (key: string, name: string, dollars: number, offset: number): PersonExtra => ({
  once: [
    {
      key,
      account: "checking",
      name,
      merchant: name,
      category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      amount: dollars,
      offsets: [offset],
    },
  ],
});

// Fuel bought through the year.
const gas = (dollars: number): Recurring => ({
  key: "taxes-gas",
  account: "checking",
  name: "SHELL OIL",
  merchant: "Shell",
  category: "TRANSPORTATION_GAS",
  amount: dollars,
  days: [6, 21],
});

export const TAXES_EXTRAS: Partial<Record<PersonId, PersonExtra>> = {
  // Jo drives to suppliers and customers.
  owner: { monthly: [gas(55)] },
  // Sam buys a Marketplace plan (in the base data) and landed a retainer client in July, so his
  // income for the year has risen past what his advance credit was set from (step 269).
  freelancer: {
    once: [
      {
        key: "taxes-new-client",
        account: "checking",
        name: "STRIPE TRANSFER - NORTHWIND STUDIO",
        merchant: null,
        category: "INCOME_CONTRACTOR",
        amount: -3500,
        offsets: [-100, -69, -38, -8],
      },
    ],
  },
  // The Reyes family: a mortgage, property tax and a year-end gift.
  family: {
    monthly: [propertyTax(2900)],
    ...gift("taxes-gift", "UNITED WAY", 300, -45),
  },
  // Priya: a big house, a gift of stock-sale proceeds, and a bond fund bought when rates were
  // lower, now worth less than she paid, in her taxable account.
  equity: {
    monthly: [
      propertyTax(6800),
      // Step 269: payroll deposits into her HSA at a pace over the self-only limit.
      {
        key: "taxes-hsa-in",
        account: "hsa",
        name: "PAYROLL HSA CONTRIBUTION",
        merchant: null,
        category: "TRANSFER_IN_ACCOUNT_TRANSFER",
        amount: -500,
        days: [15],
      },
    ],
    ...gift("taxes-gift", "AMERICAN RED CROSS", 1000, -60),
    positions: [{ account: "brokerage", key: "KTBIX", quantity: 1500, basis: 19000 }],
  },
  // Dan and Lena: a nearly paid-off home, property tax, a gift, an IRA from Lena's mother and
  // money for their daughter's down payment.
  preretire: {
    monthly: [propertyTax(3600)],
    accounts: [
      {
        key: "taxes-inherited-ira",
        name: "Inherited IRA",
        mask: "5099",
        type: "investment",
        subtype: "ira",
        balance: 0,
      },
    ],
    positions: [{ account: "taxes-inherited-ira", key: "NSTDX", quantity: 5565, basis: 100000 }],
    once: [
      {
        key: "taxes-gift-emily",
        account: "checking",
        name: "WIRE TRANSFER TO EMILY",
        merchant: null,
        category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        amount: 40000,
        offsets: [-50],
      },
      {
        key: "taxes-gift-white",
        account: "checking",
        name: "HABITAT FOR HUMANITY",
        merchant: "Habitat for Humanity",
        category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
        amount: 500,
        offsets: [-30],
      },
    ],
  },
  // Ruth owns her home outright and gives to her church. Step 269: this year she had dental implants and bought hearing aids, a big year of care.
  retiree: {
    monthly: [propertyTax(2400)],
    once: [
      {
        key: "taxes-gift",
        account: "checking",
        name: "ST MARKS CHURCH",
        merchant: "ST MARKS CHURCH",
        category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
        amount: 400,
        offsets: [-20],
      },
      {
        key: "taxes-dental",
        account: "checking",
        name: "BRIGHT SMILE DENTAL IMPLANT CENTER",
        merchant: "Bright Smile Dental",
        category: "MEDICAL_DENTAL_CARE",
        amount: 12500,
        offsets: [-150],
      },
      {
        key: "taxes-hearing",
        account: "checking",
        name: "HEARINGLIFE HEARING AIDS",
        merchant: "HearingLife",
        category: "MEDICAL_OTHER_MEDICAL",
        amount: 5800,
        offsets: [-95],
      },
    ],
  },
};
