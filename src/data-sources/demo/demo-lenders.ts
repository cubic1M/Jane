import type { LoanProduct } from "@/config/debt";

// A stand-in lender catalog for the demo bank (spec step 111): made-up lenders with
// realistic rates, fees and terms, so refinancing can be tried end to end before a loan
// marketplace partner is connected. Every offer from it is marked demo and labelled as a
// sample; it's never used for a real account.

const EXAMPLE = "https://example.com/jane-demo/lenders";

export type DemoLender = {
  key: string;
  name: string;
  product: LoanProduct;
  // The rate for a "good" credit band, before the month's move.
  baseAprBps: number;
  rateType: "fixed" | "variable";
  // An origination fee as a share of the loan, plus a flat fee (closing costs for a
  // mortgage), in cents.
  feeShare: number;
  feeFlatCents: number;
  feeLabel: string;
  minTermMonths: number;
  maxTermMonths: number;
  minAmountCents: number;
  maxAmountCents: number;
};

export const DEMO_LENDERS: readonly DemoLender[] = [
  // Student loans (the demo bank's is $18,345 at 5.25%).
  {
    key: "maple",
    name: "Maple Student Refi",
    product: "student",
    baseAprBps: 449,
    rateType: "fixed",
    feeShare: 0,
    feeFlatCents: 0,
    feeLabel: "No fees",
    minTermMonths: 60,
    maxTermMonths: 180,
    minAmountCents: 500_000,
    maxAmountCents: 30_000_000,
  },
  {
    key: "cedar",
    name: "Cedar Learning Loans",
    product: "student",
    baseAprBps: 479,
    rateType: "fixed",
    feeShare: 0,
    feeFlatCents: 0,
    feeLabel: "No fees",
    minTermMonths: 60,
    maxTermMonths: 240,
    minAmountCents: 500_000,
    maxAmountCents: 50_000_000,
  },
  {
    key: "birch",
    name: "Birch Edu Variable",
    product: "student",
    baseAprBps: 419,
    rateType: "variable",
    feeShare: 0,
    feeFlatCents: 0,
    feeLabel: "No fees; the rate can change",
    minTermMonths: 60,
    maxTermMonths: 120,
    minAmountCents: 500_000,
    maxAmountCents: 20_000_000,
  },
  // Car loans (the demo bank's is $18,020 at 6.90%).
  {
    key: "harbor",
    name: "Harbor Auto Refi",
    product: "auto",
    baseAprBps: 549,
    rateType: "fixed",
    feeShare: 0,
    feeFlatCents: 0,
    feeLabel: "No fees",
    minTermMonths: 24,
    maxTermMonths: 84,
    minAmountCents: 500_000,
    maxAmountCents: 10_000_000,
  },
  {
    key: "lakeside",
    name: "Lakeside Credit Union",
    product: "auto",
    baseAprBps: 579,
    rateType: "fixed",
    feeShare: 0,
    feeFlatCents: 7_500,
    feeLabel: "$75 title transfer fee",
    minTermMonths: 12,
    maxTermMonths: 72,
    minAmountCents: 300_000,
    maxAmountCents: 8_000_000,
  },
  {
    key: "northwind",
    name: "Northwind Auto",
    product: "auto",
    baseAprBps: 519,
    rateType: "fixed",
    feeShare: 0,
    feeFlatCents: 29_900,
    feeLabel: "$299 origination fee",
    minTermMonths: 36,
    maxTermMonths: 84,
    minAmountCents: 1_000_000,
    maxAmountCents: 12_000_000,
  },
  // Mortgages (the demo bank's is $312,400 at 3.99%, so none of these beat it).
  {
    key: "granite",
    name: "Granite Home Lending",
    product: "mortgage",
    baseAprBps: 599,
    rateType: "fixed",
    feeShare: 0.025,
    feeFlatCents: 0,
    feeLabel: "Closing costs of 2.5%",
    minTermMonths: 120,
    maxTermMonths: 360,
    minAmountCents: 5_000_000,
    maxAmountCents: 150_000_000,
  },
  {
    key: "summit",
    name: "Summit Mortgage",
    product: "mortgage",
    baseAprBps: 579,
    rateType: "fixed",
    feeShare: 0.03,
    feeFlatCents: 0,
    feeLabel: "Closing costs of 3%",
    minTermMonths: 180,
    maxTermMonths: 360,
    minAmountCents: 5_000_000,
    maxAmountCents: 200_000_000,
  },
  // Personal loans, which also take a card's balance (the demo card owes $2,410.50 at 22.99%).
  {
    key: "clearwater",
    name: "Clearwater Personal Loans",
    product: "personal",
    baseAprBps: 1199,
    rateType: "fixed",
    feeShare: 0.03,
    feeFlatCents: 0,
    feeLabel: "3% origination fee",
    minTermMonths: 24,
    maxTermMonths: 60,
    minAmountCents: 200_000,
    maxAmountCents: 5_000_000,
  },
  {
    key: "aspen",
    name: "Aspen Lending",
    product: "personal",
    baseAprBps: 1349,
    rateType: "fixed",
    feeShare: 0,
    feeFlatCents: 0,
    feeLabel: "No fees",
    minTermMonths: 24,
    maxTermMonths: 60,
    minAmountCents: 100_000,
    maxAmountCents: 4_000_000,
  },
  {
    key: "juniper",
    name: "Juniper Loans",
    product: "personal",
    baseAprBps: 1099,
    rateType: "fixed",
    feeShare: 0.05,
    feeFlatCents: 0,
    feeLabel: "5% origination fee",
    minTermMonths: 36,
    maxTermMonths: 60,
    minAmountCents: 200_000,
    maxAmountCents: 3_500_000,
  },
];

export const demoLenderUrl = (key: string) => `${EXAMPLE}/${key}`;

// Spec step 113: stand-in 0% balance transfer cards, for the demo bank's card. The fee is a
// share of what's moved with a minimum; after the 0% ends the card charges goToAprBps.
export type DemoTransferCard = {
  key: string;
  issuer: string;
  name: string;
  promoMonths: number;
  feeShare: number;
  feeMinCents: number;
  goToAprBps: number;
  maxAmountCents: number;
};

export const DEMO_TRANSFER_CARDS: readonly DemoTransferCard[] = [
  {
    key: "lumen",
    issuer: "Lumen Bank",
    name: "Lumen 0% Transfer Card",
    promoMonths: 18,
    feeShare: 0.03,
    feeMinCents: 500,
    goToAprBps: 2499,
    maxAmountCents: 1_500_000,
  },
  {
    key: "northstar",
    issuer: "Northstar Credit",
    name: "Northstar Slate",
    promoMonths: 21,
    feeShare: 0.05,
    feeMinCents: 500,
    goToAprBps: 2299,
    maxAmountCents: 2_000_000,
  },
  {
    key: "beacon",
    issuer: "Beacon Card Co.",
    name: "Beacon Intro",
    promoMonths: 12,
    feeShare: 0,
    feeMinCents: 0,
    goToAprBps: 2799,
    maxAmountCents: 800_000,
  },
];
