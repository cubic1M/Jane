import type { PersonId } from "@/config/people";
import type { PfcDetailed } from "@/categorize/taxonomy";
import type { PersonExtra } from "../demo-people";

// Things Jane already did for each sample person before today (spec step 139, gap audit), so
// "What Jane saved you" isn't $0.00 for someone who has just arrived: a subscription Jane
// cancelled, whose charges then stopped, and a refund Jane got for something sent back. The transactions
// that prove them are here (they're what /saved confirms); src/lib/sample-wins.ts records the
// finding, the decision and the finished action behind each. Sample people only.

export type SampleWin =
  | {
      kind: "cancelled";
      key: string;
      merchant: string;
      name: string;
      monthlyDollars: number;
      // The last charge came about this many days before today; Jane cancelled just after it.
      stoppedDaysAgo: number;
    }
  | {
      kind: "refund";
      key: string;
      // Something sent back that the shop hadn't refunded, until Jane asked.
      merchant: string;
      name: string;
      category: PfcDetailed;
      what: string;
      dollars: number;
      chargedDaysAgo: number;
      refundedDaysAgo: number;
    };

const cancelled = (
  key: string,
  merchant: string,
  monthlyDollars: number,
  stoppedDaysAgo = 150,
): SampleWin => ({
  kind: "cancelled",
  key,
  merchant,
  name: merchant.toUpperCase(),
  monthlyDollars,
  stoppedDaysAgo,
});

const refund = (
  key: string,
  merchant: string,
  what: string,
  dollars: number,
  category: PfcDetailed,
  chargedDaysAgo = 160,
  refundedDaysAgo = 146,
): SampleWin => ({
  kind: "refund",
  key,
  merchant,
  name: merchant.toUpperCase(),
  category,
  what,
  dollars,
  chargedDaysAgo,
  refundedDaysAgo,
});

const CLOTHES = "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES";
const FURNITURE = "HOME_IMPROVEMENT_FURNITURE";

// Each person's wins, fitting their story (src/config/people.ts).
export const SAMPLE_WINS: Record<PersonId, readonly SampleWin[]> = {
  // Maya, 24: a class pass she stopped using; a desk chair she sent back.
  renter: [
    cancelled("classpass", "ClassPass", 29),
    refund("wayfair", "Wayfair", "the desk chair you sent back", 89, FURNITURE),
  ],
  // The Reyes family: a kids' craft box the kids outgrew; clothes that didn't fit.
  family: [
    cancelled("kiwico", "KiwiCo", 24.95),
    refund("carters", "Carter's", "the kids' clothes you returned", 58.4, CLOTHES),
  ],
  // Sam, freelancer: stock photos from a finished project; a lens sent back.
  freelancer: [
    cancelled("adobe-stock", "Adobe Stock", 29.99),
    refund("bh", "B&H Photo", "the lens you sent back", 129, "GENERAL_MERCHANDISE_ELECTRONICS"),
  ],
  // Priya: a fitness app on top of a gym; a coat returned.
  equity: [
    cancelled("peloton", "Peloton App", 44),
    refund("nordstrom", "Nordstrom", "the coat you returned", 148, CLOTHES),
  ],
  // Dan & Lena: a second streaming service they'd stopped watching; a rug sent back.
  preretire: [
    cancelled("britbox", "BritBox", 8.99),
    refund("wayfair", "Wayfair", "the rug you sent back", 212, FURNITURE),
  ],
  // Ruth, 71: a newspaper she reads at the library now; shoes returned.
  retiree: [
    cancelled("wsj", "Wall Street Journal", 38.99),
    refund("zappos", "Zappos", "the shoes you returned", 74, CLOTHES),
  ],
  // Chris, in debt trouble: a meditation app; a jacket returned.
  debt: [
    cancelled("headspace", "Headspace", 12.99),
    refund("old-navy", "Old Navy", "the jacket you returned", 38, CLOTHES),
  ],
  // Jo's shop: an email marketing plan she stopped using; shipping boxes sent back.
  owner: [
    cancelled("constant-contact", "Constant Contact", 45),
    refund("uline", "Uline", "the boxes you sent back", 96, "GENERAL_MERCHANDISE_OFFICE_SUPPLIES"),
  ],
};

// The day of the month a cancelled subscription charged, and how long it had run: a month or
// two (Jane caught it early), so no subscription or spending rule counts it as a habit. The wins
// are five months back, before the months the spending detectors compare, so they don't change
// what Jane suggests today.
export const SUBSCRIPTION_DAY = 8;
const RAN_FOR_DAYS = 45;

const extraOf = (wins: readonly SampleWin[]): PersonExtra => ({
  monthly: wins.flatMap((w) =>
    w.kind === "cancelled"
      ? [
          {
            key: `win-${w.key}`,
            account: "card",
            name: w.name,
            merchant: w.merchant,
            category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" as const,
            amount: w.monthlyDollars,
            days: [SUBSCRIPTION_DAY],
            // Charged until it was cancelled; nothing after.
            span: { from: -(w.stoppedDaysAgo + RAN_FOR_DAYS), until: -w.stoppedDaysAgo + 1 },
          },
        ]
      : [],
  ),
  once: wins.flatMap((w) =>
    w.kind === "refund"
      ? [
          {
            key: `win-${w.key}-charge`,
            account: "card",
            name: w.name,
            merchant: w.merchant,
            category: w.category,
            amount: w.dollars,
            offsets: [-w.chargedDaysAgo],
          },
          // The refund, from the same shop: what Jane asked for came back.
          {
            key: `win-${w.key}-refund`,
            account: "card",
            name: `${w.name} REFUND`,
            merchant: w.merchant,
            category: w.category,
            amount: -w.dollars,
            offsets: [-w.refundedDaysAgo],
          },
        ]
      : [],
  ),
});

export const WINS_EXTRAS: Partial<Record<PersonId, PersonExtra>> = Object.fromEntries(
  Object.entries(SAMPLE_WINS).map(([id, wins]) => [id, extraOf(wins)]),
);
